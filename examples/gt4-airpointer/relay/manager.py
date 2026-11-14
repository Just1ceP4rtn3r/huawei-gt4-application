#!/usr/bin/env python3
"""Mac-owned, bounded GT4 management. Device results are never simulated."""
import ctypes
import argparse
import concurrent.futures
import json
import math
import multiprocessing as mp
import os
import pathlib
import queue
import re
import secrets
import signal
import socket
import socketserver
import subprocess
import sys
import threading
import time

PROJECT = pathlib.Path(__file__).resolve().parents[1]
ROOT = PROJECT.parents[1]
STATE = PROJECT / 'build/managed'
SOCKET = PROJECT / 'build/manager.sock'
OPS = {'hello','status','calibrate','arm','pause','mode','gain','button','pointer','probe','logs','exit','heartbeat','test'}

class Parts:
    """At most eight 960-byte ASCII messages, expiring independently."""
    def __init__(self): self.pending = {}
    def receive(self, p, now=None):
        now = time.monotonic() if now is None else now
        self.pending = {k:v for k,v in self.pending.items() if now-v['at'] < 45}
        if not isinstance(p, dict): raise ValueError('fragment must be object')
        sid, part, total, text = (p.get(k) for k in ('session','part','total','text'))
        if not isinstance(sid,str) or not re.fullmatch('[0-9a-fA-F]{8}',sid): raise ValueError('invalid fragment session')
        if type(part) is not int or type(total) is not int or not 1 <= part <= total <= 20: raise ValueError('invalid fragment index')
        if not isinstance(text,str) or len(text)>48 or not text.isascii(): raise ValueError('invalid fragment text')
        if sid not in self.pending:
            if len(self.pending)>=8: raise ValueError('fragment capacity exceeded')
            self.pending[sid]={'at':now,'total':total,'pieces':{}}
        item=self.pending[sid]
        if item['total']!=total or (part in item['pieces'] and item['pieces'][part]!=text):
            del self.pending[sid]; raise ValueError('conflicting fragment')
        item['pieces'][part]=text
        if len(item['pieces'])!=total:return None
        del self.pending[sid]
        result=json.loads(''.join(item['pieces'][i] for i in range(1,total+1)))
        if not isinstance(result,dict): raise ValueError('RPC must be object')
        return result

class Protocol:
    def __init__(self, enabled=False):
        self.enabled=enabled; self.session=secrets.token_hex(8); self.command_id=0
        self.boot=None; self.last_seq=-1; self.ready=False; self.last_state=None; self.version=None; self.cycle=None
    def event(self, value):
        if value.get('v')!=1 or value.get('t')!='rpc' or not re.fullmatch('[0-9a-fA-F]{8}',str(value.get('boot',''))):raise ValueError('invalid RPC envelope')
        if type(value.get('seq')) is not int or value['seq']<0 or value.get('event') not in {'ready','ack','state','log','probe'}:raise ValueError('invalid RPC event')
        if type(value.get('id')) is not int or value['id']<0 or not isinstance(value.get('session'),str) or not isinstance(value.get('data'),dict):raise ValueError('invalid RPC fields')
        if value['event'] in {'ack','state'} and value['session']!=self.session:raise ValueError('RPC session mismatch')
        if self.boot!=value['boot']:
            if value['event']!='ready':raise ValueError('unknown boot without ready')
            self.boot=value['boot'];self.last_seq=-1;self.ready=False
        if value['seq']<=self.last_seq:return False
        self.last_seq=value['seq']
        if value['event']=='ready':self.ready=True;self.version=value['data'].get('version');self.cycle=value['data'].get('cycle')
        if value['event']=='state':self.last_state=value['data']
        return True
    def command(self, op, args):
        if op not in OPS:raise ValueError('unsupported operation')
        if not self.ready:raise RuntimeError('watch application not ready')
        if not isinstance(args,dict):raise ValueError('args must be object')
        args=dict(args)
        if op in {'hello','arm','heartbeat'}:args['enabled']=self.enabled
        if op=='arm':args['lease']=1500
        self.command_id+=1
        return {'v':1,'t':'command','session':self.session,'id':self.command_id,'op':op,'args':args,'ttl':15000}

def private_json(path, value):
    tmp=path.with_name(path.name+'.'+str(os.getpid())+'.'+str(threading.get_ident())+'.tmp')
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f:json.dump(value,f,allow_nan=False);f.write('\n')
    os.replace(tmp,path);os.chmod(path,0o600)

def bootstrap_phone(session, events, deadline=None):
    """Restore an existing saved pairing through the app UI; never create a pairing."""
    script=session.create_script((PROJECT/'build/phone-bootstrap.js').read_text())
    def emit(value):
        if not isinstance(value,dict):value={'phase':'invalid-bootstrap-result'}
        safe={k:v for k,v in value.items() if (k=='phase' and isinstance(v,str) and len(v)<=120) or (k in {'ready','paired','channelReady','hasWriter'} and type(v) is bool)}
        try:events.put_nowait({'type':'send','payload':{'kind':'phone-bootstrap','payload':safe}})
        except queue.Full:pass
        return safe
    script.load()
    try:
        emit({'phase':'ready-attaching','ready':False})
        emit(script.exports_sync.prepare())
        end=time.monotonic()+45
        if deadline is not None:end=min(end,deadline)
        last={'phase':'not-stepped','ready':False}
        while time.monotonic()<end:
            value=script.exports_sync.step();last=emit(value)
            if isinstance(value,dict) and value.get('ready') is True:return last
            time.sleep(1)
        raise TimeoutError('phone bootstrap deadline: '+json.dumps(last))
    finally:
        # Restore idleTimer before the adapter reserve snapshots the original value.
        try:script.exports_sync.release()
        finally:script.unload()

def restart_crescent(pid):
    """One exact application PID only, checked against the current executable name."""
    if type(pid) is not int or pid<=1:raise ValueError('invalid Crescent PID')
    def ssh(command):
        result=subprocess.run(['bash',str(ROOT/'scripts/ssh.sh'),'HISTFILE=/dev/null; export HISTFILE; '+command],timeout=5,capture_output=True)
        if result.returncode:raise RuntimeError('Crescent recovery SSH command failed ('+str(result.returncode)+')')
        return result.stdout.decode(errors='replace')
    processes={}
    for line in ssh('ps -axo pid,comm').splitlines():
        fields=line.strip().split(None,1)
        if len(fields)==2 and fields[0].isdigit():processes[int(fields[0])]=pathlib.PurePosixPath(fields[1]).name
    if pid in processes:
        if processes[pid]!='CrescentRelay':raise RuntimeError('refusing to terminate PID whose executable is not CrescentRelay')
        ssh('kill -TERM '+str(pid))
    ssh('uiopen --bundleid local.gt4bridge.crescent')

def attach_phone(device, events, deadline):
    previous_pid=None
    for attempt in range(2):
        end=min(time.monotonic()+8,deadline)
        while True:
            procs=[p for p in device.enumerate_processes() if p.name=='CrescentRelay' and p.pid!=previous_pid]
            if len(procs)==1:break
            if time.monotonic()>=end:raise RuntimeError('CrescentRelay process not found uniquely after uiopen')
            time.sleep(.25)
        current=procs[0];session=device.attach(current.pid)
        try:
            bootstrap_phone(session,events,deadline=deadline)
            return session
        except TimeoutError:
            session.detach()
            if attempt:raise
            events.put_nowait({'type':'send','payload':{'kind':'phone-bootstrap','payload':{'phase':'restarting-Crescent-once','ready':False}}})
            restart_crescent(current.pid);previous_pid=current.pid
        except Exception:
            session.detach();raise
    raise RuntimeError('phone connection recovery exhausted')

def frida_worker(commands, replies, events):
    """All potentially blocking native calls live in this killable process."""
    agent=session=None
    try:
        import frida
        device=frida.get_device_manager().add_remote_device('127.0.0.1:27043')
        session=attach_phone(device,events,time.monotonic()+115)
        agent=session.create_script((PROJECT/'build/iphone-agent.js').read_text())
        def incoming(message, _):
            try:events.put_nowait(message)
            except queue.Full:pass
        agent.on('message',incoming);agent.load();replies.put((0,True,{'attached':True}))
        while True:
            serial, method, args=commands.get()
            if method=='quit':
                try:agent.exports_sync.release()
                except Exception:pass
                try:agent.unload()
                except Exception:pass
                break
            try:
                result=getattr(agent.exports_sync,method)(*args)
                replies.put((serial,True,result))
            except Exception as error:replies.put((serial,False,str(error)))
    except Exception as error:replies.put((0,False,str(error)))
    finally:
        if session:
            try:session.detach()
            except Exception:pass

class Manager:
    def __init__(self, enabled=False):
        self.protocol=Protocol(enabled);self.parts=Parts();self.lock=threading.RLock()
        self.condition=threading.Condition();self.shutdown=threading.Event();self.app_ready=threading.Event()
        self.phase='starting';self.error=None;self.control_ready=False;self.pending=None;self.acks={}
        self.phone_acks=[];self.children=[];self.ownership={'server':False,'tunnel':False}
        self.worker=None;self.serial=0;self.rpc_lock=threading.Lock();self.dispatch_lock=threading.Lock();self.command_lock=threading.RLock()
        self.armed=False;self.last_event=None;self.test_result=None;self.remote_owned_pids=[];self.closing=False;self.phone_phase=None;self.wire_stats=None;self.phone_attached_at=None;self.last_wire_stats=None;self.last_foreground_attempt=None;self.foreground_running=False
        self.sink=None;self.pointer_queue=queue.Queue(4);self.pointer_received=0;self.armed_frames=0
        self.motion_abs={'x':0.0,'y':0.0};self.desktop_receipt=None;self.pointer_forwarded=0;self.pointer_dropped=0;self.exit_result=None;self.origin_counts={};self.backend_counts={};self.latest_pointer=None;self.synthetic_pointer=None;self.pointer_activity_session=None;self.pointer_activity_seq=0;self.pointer_activity_offset=None;self.pointer_retired=[];self.last_pointer_activity=None
        self.bootstrap_complete=False;self.recovering=False;self.silence_running=False;self.exiting=False;self.lifecycle_generation=0;self.last_managed_part=time.monotonic()
        STATE.mkdir(parents=True,exist_ok=True);os.chmod(STATE,0o700)
    def log(self, kind, payload):
        with self.lock:
            fd=os.open(STATE/'events.ndjson',os.O_WRONLY|os.O_APPEND|os.O_CREAT,0o600)
            with os.fdopen(fd,'w') as f:f.write(json.dumps({'at':time.time(),'kind':kind,'payload':payload},allow_nan=False)+'\n')
    def status(self):
        with self.lock:
            return {'phase':self.phase,'controlReady':self.control_ready,'watchReady':self.protocol.ready,'boot':self.protocol.boot,
                    'enabled':self.protocol.enabled,'phonePhase':self.phone_phase,'wireStats':self.wire_stats,'wireStatsAge':None if self.last_wire_stats is None else max(0,time.monotonic()-self.last_wire_stats),'armed':self.armed,'version':self.protocol.version,'cycle':self.protocol.cycle,'recovering':self.recovering,'lastManagedPartAge':max(0,time.monotonic()-self.last_managed_part),'lastPointerActivityAge':None if self.last_pointer_activity is None else max(0,time.monotonic()-self.last_pointer_activity),'remoteOwnedPids':self.remote_owned_pids,'error':self.error,'inFlight':self.pending,
                    'originCounts':dict(self.origin_counts),'backendCounts':dict(self.backend_counts),'latestPointer':self.latest_pointer,'pointerReceived':self.pointer_received,'pointerForwarded':self.pointer_forwarded,'pointerDropped':self.pointer_dropped,'armedFrames':self.armed_frames,'motionAbs':dict(self.motion_abs),'latestDesktopReceipt':self.desktop_receipt[1] if self.desktop_receipt else None,'exitResult':self.exit_result,
                    'ownership':dict(self.ownership),'ownedPids':[p.pid for p in self.children if p.poll() is None],'phoneAcks':self.phone_acks[-8:],'lastEvent':self.last_event,'test':self.test_result}
    def save(self):private_json(STATE/'state.json',self.status())
    @staticmethod
    def valid_pointer(frame):
        if not isinstance(frame,dict) or frame.get('v')!=1 or frame.get('t')!='pointer':return False
        if not isinstance(frame.get('session'),str) or not re.fullmatch('[0-9-]{1,64}',frame['session']):return False
        if type(frame.get('seq')) is not int or not 0<frame['seq']<9000000000000000 or type(frame.get('armed')) is not bool:return False
        for key,limit in [('dx',100),('dy',100),('scroll',60),('sent',float('inf'))]:
            v=frame.get(key)
            if type(v) not in (int,float) or not math.isfinite(v) or abs(v)>limit:return False
        if not isinstance(frame.get('buttons'),list) or len(frame['buttons'])>8:return False
        for button in frame['buttons']:
            if not isinstance(button,dict) or type(button.get('id')) is not int or not 0<button['id']<2**62:return False
            if button.get('kind') not in {'left','right','double','drag'} or type(button.get('age')) not in (int,float) or not math.isfinite(button['age']) or not 0<=button['age']<=1000:return False
        return True
    def receive_pointer(self, frame):
        if not self.valid_pointer(frame):self.log('rejected-pointer','invalid frame');return False
        with self.lock:
            self.pointer_received+=1;self.armed_frames+=int(frame['armed'])
            origin=frame.get('origin','unspecified');backend=frame.get('backend','unspecified')
            if origin not in {'real-sensor','synthetic-watch-test'}:origin='unspecified'
            if backend not in {'experimental-ping','wearengine','legacy'}:backend='unspecified'
            self.origin_counts[origin]=self.origin_counts.get(origin,0)+1;self.backend_counts[backend]=self.backend_counts.get(backend,0)+1
            self.latest_pointer={k:frame.get(k) for k in ('seq','sent','armed','dx','dy','scroll')}
            self.latest_pointer.update(origin=origin,backend=backend)
            if origin=='synthetic-watch-test':self.synthetic_pointer=(time.monotonic(),dict(frame))
            self.record_pointer_activity(frame)
            self.motion_abs['x']+=abs(frame['dx']);self.motion_abs['y']+=abs(frame['dy'])
        item=(time.monotonic(),frame)
        try:self.pointer_queue.put_nowait(item)
        except queue.Full:
            try:self.pointer_queue.get_nowait();self.pointer_dropped+=1
            except queue.Empty:pass
            try:self.pointer_queue.put_nowait(item)
            except queue.Full:self.pointer_dropped+=1
        return True
    def record_pointer_activity(self, frame):
        # Pointer streams can occupy detect continuously, starving optional ready/state beacons.
        # Only validated application-origin frames can substitute for management activity.
        if frame.get('origin') not in {'real-sensor','synthetic-watch-test'} or frame.get('backend') not in {'experimental-ping','wearengine','legacy'}:return False
        now=time.monotonic();offset=now-frame['sent']/1000
        # Device and Mac clocks need not match. Establish a relative baseline
        # within the authenticated application session, as the desktop gate does.
        session=frame['session']
        if session!=self.pointer_activity_session:
            if session in self.pointer_retired:return False
            if self.pointer_activity_session is not None:
                self.pointer_retired.append(self.pointer_activity_session);self.pointer_retired=self.pointer_retired[-16:]
            if not self.control_ready:return False
            self.pointer_activity_session=session;self.pointer_activity_seq=frame['seq'];self.pointer_activity_offset=offset
            return False
        if frame['seq']<=self.pointer_activity_seq:return False
        if self.pointer_activity_offset is not None and offset-self.pointer_activity_offset>.25:return False
        self.pointer_activity_seq=frame['seq'];self.pointer_activity_offset=min(offset,self.pointer_activity_offset if self.pointer_activity_offset is not None else offset)
        self.last_pointer_activity=now;return True
    def receipt_fresh(self, frame, now=None):
        now=time.monotonic() if now is None else now
        receipt=self.desktop_receipt
        return bool(receipt and 0<=now-receipt[0]<.5 and receipt[1].get('session')==frame['session'])
    def start_sink(self):
        executable=PROJECT/'build/GT4AirPointerSink'
        if not executable.is_file():raise RuntimeError('desktop sink is missing; build the application first')
        stderr=open(STATE/'sink.log','ab');os.chmod(stderr.name,0o600)
        self.sink=subprocess.Popen([str(executable),'--enable' if self.protocol.enabled else '--dry-run'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=stderr,start_new_session=True)
        stderr.close();self.children.append(self.sink)
        threading.Thread(target=self.sink_receipts,daemon=True).start()
        threading.Thread(target=self.sink_forward,daemon=True).start()
        self.shutdown.wait(.1)
        if self.sink.poll() is not None:raise RuntimeError('desktop sink refused startup; inspect managed/sink.log')
    def sink_receipts(self):
        while not self.shutdown.is_set():
            raw=self.sink.stdout.readline(8193)
            if not raw:return
            if len(raw)>8192:continue
            try:
                value=json.loads(raw)
                if isinstance(value,dict) and value.get('t')=='desktop' and isinstance(value.get('session'),str):
                    with self.lock:self.desktop_receipt=(time.monotonic(),value)
            except (ValueError,UnicodeError):pass
    def sink_forward(self):
        status_at=0
        while not self.shutdown.is_set() and not self.closing:
            try:received,frame=self.pointer_queue.get(timeout=.1)
            except queue.Empty:continue
            if time.monotonic()-received>.2:self.pointer_dropped+=1;continue
            try:
                if not self.sink or self.sink.poll() is not None:raise RuntimeError('desktop sink exited')
                encoded=json.dumps(frame,separators=(',',':'),allow_nan=False).encode()+b'\n'
                if len(encoded)>4096:raise ValueError('pointer frame exceeds sink budget')
                self.sink.stdin.write(encoded);self.sink.stdin.flush();self.pointer_forwarded+=1
                now=time.monotonic()
                if self.receipt_fresh(frame,now) and now-status_at>=1:
                    self.rpc('status',timeout=2);status_at=now;self.save()
            except Exception as e:self.log('sink-error',str(e));self.armed=False;return
    def spawn(self, kind):
        f=open(STATE/(kind+'.log'),'ab');os.chmod(f.name,0o600)
        p=subprocess.Popen(['bash',str(ROOT/'scripts/connect-iphone.sh'),kind],stdout=f,stderr=f,start_new_session=True)
        f.close();self.children.append(p);self.ownership[kind]=True
    def rpc(self, method, *args, timeout=8):
        end=time.monotonic()+timeout
        if not self.rpc_lock.acquire(timeout=timeout):raise TimeoutError('Frida RPC queue deadline: '+method)
        try:
            if not self.worker or not self.worker.is_alive():raise RuntimeError('Frida worker unavailable')
            self.serial+=1;serial=self.serial;self.commands.put((serial,method,args),timeout=min(timeout,1))
            while not self.shutdown.is_set():
                left=end-time.monotonic()
                if left<=0:
                    self.worker.terminate();raise TimeoutError('Frida RPC deadline: '+method)
                try:s,ok,value=self.replies.get(timeout=min(left,.2))
                except queue.Empty:continue
                if s!=serial:continue
                if not ok:raise RuntimeError('Frida '+method+': '+str(value))
                return value
            raise RuntimeError('manager stopping')
        finally:self.rpc_lock.release()
    def dispatch(self, op, args=None, timeout=8, track=False):
        # Allocate IDs in actual send order, including heartbeats interleaved with application ACK waits.
        if not self.dispatch_lock.acquire(timeout=timeout):raise TimeoutError('command dispatch deadline')
        try:
            with self.condition:
                command=self.protocol.command(op,args or {})
                if track:self.pending=command
                if op=='arm':self.armed=self.protocol.enabled
                if op in {'pause','exit'}:self.armed=False
                if op=='exit':self.exiting=True
            self.log('command' if track else 'transport-only-command',command)
            result=self.rpc('command',command,timeout=timeout)
            return command,result
        finally:self.dispatch_lock.release()
    def transport_only(self, op, args=None, timeout=3):
        return self.dispatch(op,args,timeout=timeout)[1]
    @staticmethod
    def parse_server_pids(text):
        pids=set()
        for line in text.splitlines():
            fields=line.strip().split(None,1)
            if len(fields)==2 and fields[0].isdigit() and pathlib.PurePosixPath(fields[1]).name=='frida-server':pids.add(int(fields[0]))
        return pids
    def server_pids(self):
        result=subprocess.run(['bash',str(ROOT/'scripts/ssh.sh'),'HISTFILE=/dev/null; export HISTFILE; ps -axo pid,comm'],timeout=12,capture_output=True)
        if result.returncode:raise RuntimeError('cannot inspect existing Frida server via SSH ps')
        return self.parse_server_pids(result.stdout.decode(errors='replace'))
    def handle(self, message):
        if message.get('type')=='error':self.log('agent-error',message.get('description'));return
        event=message.get('payload',{})
        if not isinstance(event,dict):return
        kind=event.get('kind')
        if kind=='pointer':
            self.receive_pointer(event.get('payload'));return
        if kind=='phone-bootstrap':
            self.phone_phase=event.get('payload',{})
            if self.phase in {'starting','phone-connecting'}:self.phase='phone-connecting'
            self.log(kind,self.phone_phase);self.save();return
        if kind=='wire-stats':
            raw=event.get('payload')
            if not isinstance(raw,dict):return
            self.last_wire_stats=time.monotonic()
            self.wire_stats={'at':time.time(),**self.safe_wire_stats(raw)}
            connection=self.wire_stats.get('connection',{})
            invalid=[k for k in ('sameGeneration','paired','ready') if connection.get(k) is False]
            if invalid:
                with self.condition:
                    self.phase='error';self.error='phone adapter connection invalid: '+','.join(invalid)
                    self.control_ready=False;self.protocol.ready=False;self.armed=False;self.cancel_pending(self.error)
            private_json(STATE/'wire-stats.json',self.wire_stats);self.save();return
        if kind=='p2p-ack':
            event=event.get('payload',event)
            with self.condition:
                self.phone_acks.append({'at':time.monotonic(),'sequence':event.get('sequence'),'code':event.get('code')});self.phone_acks=self.phone_acks[-32:];self.condition.notify_all()
            self.log(kind,event);return
        if kind!='managed-part':return
        self.last_managed_part=time.monotonic()
        try:
            value=self.parts.receive(event.get('payload'))
            if value is None:return
            with self.condition:
                old_boot=self.protocol.boot;old_cycle=self.protocol.cycle
                if not self.protocol.event(value):return
                changed=old_boot is not None and (old_boot,old_cycle)!=(self.protocol.boot,self.protocol.cycle)
                if changed:
                    self.lifecycle_generation+=1;self.control_ready=False;self.armed=False
                    self.cancel_pending('watch lifecycle changed')
                self.last_event=value
                if value['event']=='ready':self.app_ready.set()
                if value['event']=='ack':self.acks[(value['session'],value['id'])]=value
                if len(self.acks)>32:self.acks.pop(next(iter(self.acks)))
                self.condition.notify_all()
            self.log('watch-rpc',value);self.save()
            if value['event']=='ready' and self.bootstrap_complete and not self.closing and not self.exiting:
                if changed or (not self.control_ready and not self.recovering):self.schedule_recovery()
        except (ValueError,KeyError,TypeError) as e:self.log('rejected-fragment',str(e))
    def cancel_pending(self, reason):
        if self.pending:self.acks[(self.pending['session'],self.pending['id'])]={'data':{'ok':False,'error':reason}}
        self.condition.notify_all()
    def schedule_recovery(self):
        with self.condition:
            if self.recovering or self.closing or self.exiting or (self.phase=='error' and str(self.error).startswith('phone adapter')):return
            self.recovering=True;self.control_ready=False;self.armed=False;self.phase='recovering-watch'
        threading.Thread(target=self.recovery_loop,daemon=True).start()
    def recovery_loop(self):
        acquired=False
        try:
            end=time.monotonic()+40
            while not self.shutdown.is_set() and not self.closing:
                if self.command_lock.acquire(timeout=.2):acquired=True;break
                if time.monotonic()>=end:raise TimeoutError('recovery command lock deadline')
            if not acquired:return
            # Lifecycle may change during a handshake; at most two fresh handshakes per recovery.
            for _ in range(2):
                generation=self.lifecycle_generation
                try:
                    self.execute('hello',{'enabled':self.protocol.enabled});self.execute('status')
                except Exception:
                    if generation!=self.lifecycle_generation:continue
                    raise
                if generation==self.lifecycle_generation:
                    self.control_ready=True;self.error=None;self.phase='ready';self.save();return
            raise RuntimeError('watch lifecycle changed repeatedly during recovery')
        except Exception as e:
            self.control_ready=False;self.armed=False;self.error=str(e);self.phase='error';self.log('recovery-error',str(e))
        finally:
            if acquired:self.command_lock.release()
            self.recovering=False;self.save()
    def silence_recovery(self):
        try:
            with self.condition:
                self.control_ready=False;self.protocol.ready=False;self.armed=False;self.phase='waiting-watch-recovery'
                self.app_ready.clear();self.cancel_pending('watch beacons stopped')
            end=time.monotonic()+30
            for attempt in range(3):
                if self.closing or self.exiting or self.shutdown.is_set():return
                self.log('recovery-ping',{'attempt':attempt+1,'result':self.rpc('ping',timeout=5)})
                if self.app_ready.wait(min(5,max(0,end-time.monotonic()))):return
            if not self.app_ready.wait(max(0,end-time.monotonic())):raise TimeoutError('watch silent after three recovery pings')
        except Exception as e:
            self.control_ready=False;self.armed=False;self.error=str(e);self.phase='error';self.log('silence-recovery-error',str(e))
        finally:self.silence_running=False;self.save()
    def events_loop(self):
        while not self.shutdown.is_set():
            try:self.handle(self.events.get(timeout=.2))
            except queue.Empty:pass
            except Exception as e:self.log('event-error',str(e))
    def execute(self, op, args=None, timeout=35):
        if not self.command_lock.acquire(blocking=False):raise RuntimeError('another command is in flight')
        try:
            end=time.monotonic()+max(30,timeout)
            cursor_test=op=='test' and isinstance(args,dict) and args.get('scenario')=='cursor'
            evidence=self.begin_cursor_test() if cursor_test else None
            command,transport=self.dispatch(op,args,timeout=8,track=True)
            self.save()
            self.log('transport-command',{'id':command['id'],'result':transport})
            key=(command['session'],command['id'])
            with self.condition:
                while key not in self.acks:
                    left=end-time.monotonic()
                    if left<=0:raise TimeoutError('application ack timeout: '+op+' (transport ack is not application success)')
                    if self.shutdown.is_set():raise RuntimeError('manager stopping')
                    self.condition.wait(min(left,.25))
                ack=self.acks.pop(key)
            data=ack['data']
            if data.get('ok') is not True:raise RuntimeError('watch command failed: '+str(data.get('error',ack.get('error','missing ok:true'))))
            if op=='arm':self.armed=self.protocol.enabled
            if op in {'pause','exit'}:self.armed=False
            if op=='exit':
                self.exiting=True;self.phase='watch-exiting';self.control_ready=False;self.protocol.ready=False
                self.exit_result={'acknowledged':True,'ack':ack,'terminationConfirmed':False}
            result={'command':command,'ack':ack,'transport':transport}
            if cursor_test:
                result['desktopTest']=self.finish_cursor_test(evidence);self.log('cursor-test',result['desktopTest'])
            return result
        except Exception:
            if op=='arm':self.armed=False
            raise
        finally:
            self.pending=None;self.save();self.command_lock.release()
    @staticmethod
    def cursor_position():
        # Read the actual CG cursor without injecting input or requiring a phone RPC.
        class Point(ctypes.Structure):_fields_=[('x',ctypes.c_double),('y',ctypes.c_double)]
        try:
            cg=ctypes.CDLL('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
            cg.CGEventCreate.argtypes=[ctypes.c_void_p];cg.CGEventCreate.restype=ctypes.c_void_p
            cg.CGEventGetLocation.argtypes=[ctypes.c_void_p];cg.CGEventGetLocation.restype=Point
            cf=ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
            cf.CFRelease.argtypes=[ctypes.c_void_p]
            event=cg.CGEventCreate(None)
            if not event:return None
            try:point=cg.CGEventGetLocation(event);return {'x':point.x,'y':point.y}
            finally:cf.CFRelease(event)
        except (OSError,AttributeError):return None
    def begin_cursor_test(self):
        return {'started':time.monotonic(),'beforeCursor':self.cursor_position(),
                'beforeReceipt':dict(self.desktop_receipt[1]) if self.desktop_receipt else None}
    def finish_cursor_test(self, evidence):
        end=evidence['started']+8;frame=None;receipt=None
        while True:
            sample=self.synthetic_pointer
            if sample and sample[0]>=evidence['started']:
                frame=sample[1]
                current=self.desktop_receipt
                if current and current[0]>=sample[0] and current[1].get('session')==frame['session'] and current[1].get('seq')==frame['seq']:
                    receipt=dict(current[1]);break
            if time.monotonic()>=end or self.shutdown.wait(.02):break
        after=self.cursor_position();before=evidence['beforeCursor']
        moved=bool(before is not None and after is not None and before!=after)
        enabled=bool(self.protocol.enabled and receipt and receipt.get('enabled') is True)
        return {'ok':bool(enabled and frame and frame.get('armed') and receipt and moved),'enabled':enabled,
                'pointerReceived':frame is not None,'syntheticSeq':frame.get('seq') if frame else None,
                'beforeCursor':before,'afterCursor':after,'cursorMoved':moved,
                'beforeDesktopReceipt':evidence['beforeReceipt'],'afterDesktopReceipt':receipt,
                'note':'watch ACK alone does not confirm desktop input; dry-run never succeeds'}
    def bootstrap(self):
        try:
            before=self.server_pids()
            if not before:self.spawn('server')
            try:
                with socket.create_connection(('127.0.0.1',27043),timeout=1):pass
            except OSError:self.spawn('tunnel')
            opened=subprocess.run(['bash',str(ROOT/'scripts/ssh.sh'),'HISTFILE=/dev/null; export HISTFILE; uiopen --bundleid local.gt4bridge.crescent'],timeout=12,capture_output=True)
            if opened.returncode:raise RuntimeError('uiopen failed: '+opened.stderr.decode(errors='replace')[-500:])
            if self.ownership['server']:
                deadline=time.monotonic()+5
                while True:
                    new=self.server_pids()-before
                    if len(new)==1:
                        self.remote_owned_pids=sorted(new);break
                    if time.monotonic()>=deadline:raise RuntimeError('cannot identify uniquely owned remote Frida PID')
                    if self.shutdown.wait(.3):return
            # Local readiness wait; no additional phone files are created.
            end=time.monotonic()+12
            while True:
                try:
                    with socket.create_connection(('127.0.0.1',27043),timeout=.5):break
                except OSError:
                    if time.monotonic()>end:raise TimeoutError('Frida tunnel did not become reachable')
                    if self.shutdown.wait(.3):return
            self.commands=mp.Queue(8);self.replies=mp.Queue(16);self.events=mp.Queue(128)
            self.worker=mp.Process(target=frida_worker,args=(self.commands,self.replies,self.events),daemon=True);self.worker.start()
            self.phase='phone-connecting';self.save()
            threading.Thread(target=self.events_loop,daemon=True).start()
            try:_,ok,result=self.replies.get(timeout=120)
            except queue.Empty:
                self.worker.terminate();raise TimeoutError('phone connection/Frida bootstrap/recovery exceeded 120 seconds')
            if not ok:raise RuntimeError(str(result))
            self.phone_attached_at=time.monotonic()
            # Imported only after startup; offline tests do not need frida.
            from relay import application_identity
            self.rpc('configure',application_identity(),self.protocol.enabled);self.rpc('reserve')
            self.start_sink()
            threading.Thread(target=self.stats_loop,daemon=True).start()
            self.phase='waiting-watch';self.save();ready_deadline=time.monotonic()+120
            for attempt in range(3):
                if self.app_ready.is_set():break
                self.log('startup-ping',{'attempt':attempt+1,'result':self.rpc('ping')})
                self.app_ready.wait(min(3,max(0,ready_deadline-time.monotonic())))
            if not self.app_ready.is_set() and self.pointer_received:
                # A running pointer stream can starve optional ready beacons.
                # A fresh hello only pauses the old session; it never arms input.
                self.protocol.command_id+=1
                hello={'v':1,'t':'command','session':self.protocol.session,'id':self.protocol.command_id,'op':'hello','args':{'enabled':self.protocol.enabled},'ttl':15000}
                self.log('bootstrap-pause-stream',self.rpc('command',hello))
            if not self.app_ready.wait(max(0,ready_deadline-time.monotonic())):raise TimeoutError('no application ready beacon within 120 seconds; native ping ACK is insufficient')
            self.phase='handshaking';self.save()
            self.execute('hello',{'enabled':self.protocol.enabled});self.execute('status')
            self.bootstrap_complete=True;self.control_ready=True;self.phase='ready';self.save()
            threading.Thread(target=self.heartbeat_loop,daemon=True).start()
        except Exception as e:
            if not self.shutdown.is_set():self.error=str(e);self.phase='error';self.log('startup-error',str(e));self.save()
    @staticmethod
    def safe_wire_stats(raw):
        def number(value):return type(value) in (int,float) and math.isfinite(value) and value>=0
        out={k:raw[k] for k in ('p2pPackets','routeMatches','ackSent','ackFailed','wireFrames') if number(raw.get(k))}
        for key in ('frameFlags','packetTypes','notificationTypes'):
            value=raw.get(key)
            if isinstance(value,dict):out[key]={k:v for k,v in list(value.items())[:64] if isinstance(k,str) and len(k)<=64 and number(v)}
        if isinstance(raw.get('connection'),dict):
            out['connection']={k:v for k,v in raw['connection'].items() if k in {'sameGeneration','paired','ready'} and type(v) is bool}
        if isinstance(raw.get('wireTail'),list):
            out['wireTail']=[]
            for item in raw['wireTail'][-32:]:
                if not isinstance(item,dict):continue
                safe={k:v for k,v in item.items() if k in {'at','sid','cid','length','flag','sequence'} and (number(v) or v is None)}
                for k in ('event','uuid'):
                    if isinstance(item.get(k),str) and len(item[k])<=64:safe[k]=item[k]
                out['wireTail'].append(safe)
        return out
    def foreground_phone(self):
        try:
            result=subprocess.run(['bash',str(ROOT/'scripts/ssh.sh'),'HISTFILE=/dev/null; export HISTFILE; uiopen --bundleid local.gt4bridge.crescent'],timeout=12,capture_output=True)
            self.log('phone-foreground',{'ok':result.returncode==0})
        except Exception as e:self.log('phone-foreground-error',str(e))
        finally:self.foreground_running=False
    def monitor_local(self):
        now=time.monotonic()
        if self.worker and not self.worker.is_alive():
            failure='phone adapter worker exited'
        elif self.phone_attached_at is not None:
            age=now-(self.last_wire_stats if self.last_wire_stats is not None else self.phone_attached_at)
            if age>=10 and not self.foreground_running and (self.last_foreground_attempt is None or now-self.last_foreground_attempt>=15):
                self.last_foreground_attempt=now;self.foreground_running=True
                threading.Thread(target=self.foreground_phone,daemon=True).start()
            failure='phone adapter wire-stats silent for 30 seconds' if age>=30 else None
        else:failure=None
        if failure:
            with self.condition:
                self.control_ready=False;self.armed=False;self.error=failure;self.phase='error';self.cancel_pending(failure)
            self.save();return
        if self.bootstrap_complete and not self.exiting and self.phase!='error' and not self.recovering and not self.silence_running and now-max(self.last_managed_part,self.last_pointer_activity if self.last_pointer_activity is not None else self.last_managed_part)>=20:
            self.silence_running=True;threading.Thread(target=self.silence_recovery,daemon=True).start()
    def stats_loop(self):
        # Observations arrive asynchronously; never queue a stats RPC behind a native callback.
        while not self.shutdown.wait(1):
            if not self.closing:self.monitor_local()
    def heartbeat_loop(self):
        while not self.shutdown.wait(.45):
            if self.armed and not self.closing:
                try:self.transport_only('heartbeat',{'enabled':self.protocol.enabled})
                except Exception as e:self.armed=False;self.log('heartbeat-error',str(e))
    @staticmethod
    def counters(value):
        found={}
        def walk(v,path=''):
            if isinstance(v,dict):
                for k,x in v.items():
                    name=(path+'.'+k).lstrip('.')
                    if k in {'a','g','accelCount','gyroCount','accelerometerCount','gyroscopeCount'} and type(x) in {int,float}:found[name]=x
                    walk(x,name)
        walk(value);return found
    def test(self):
        results=[]
        def step(op,args=None):
            try:
                r=self.execute(op,args)
                probe_result=r['ack']['data'].get('result',{})
                ok=not (op=='probe' and isinstance(probe_result,dict) and probe_result.get('ok') is False)
                results.append({'op':op,'args':args,'ok':ok,'result':r});return r
            except Exception as e:results.append({'op':op,'args':args,'ok':False,'error':str(e)});return None
        step('hello',{'enabled':self.protocol.enabled})
        first=step('status');self.shutdown.wait(1.5);second=step('status')
        a=self.counters(first or {});b=self.counters(second or {})
        growth={k:b[k]-v for k,v in a.items() if k in b}
        results.append({'op':'sensor-growth','ok':bool(growth) and any(v>0 for v in growth.values()),'deltas':growth,'note':'real watch counters only; absent counters are not a pass'})
        calibrated=step('calibrate')
        calibration_ready=False;deadline=time.monotonic()+30
        if calibrated:
            while time.monotonic()<deadline and not self.shutdown.is_set():
                state=step('status')
                result=(state or {}).get('ack',{}).get('data',{}).get('result',{})
                if result.get('ready') is True:calibration_ready=True;break
                self.shutdown.wait(.75)
        results.append({'op':'calibration-ready','ok':calibration_ready,'note':'requires actual watch status ready:true after calibrate'})
        for api in ('wearengine','legacy'):step('probe',{'api':api})
        step('logs');step('pause')
        self.test_result={'realDevice':True,'ok':all(x['ok'] for x in results),'steps':results};self.save();return self.test_result
    def exit_watch(self, timeout=8):
        end=time.monotonic()+timeout
        command,_=self.dispatch('exit',timeout=min(2,timeout),track=False)
        key=(command['session'],command['id'])
        with self.condition:
            while key not in self.acks:
                left=end-time.monotonic()
                if left<=0:raise TimeoutError('watch exit application ACK not received within 8 seconds')
                self.condition.wait(min(left,.2))
            ack=self.acks.pop(key)
        if ack.get('data',{}).get('ok') is not True:raise RuntimeError('watch exit rejected')
        return {'acknowledged':True,'ack':ack,'terminationConfirmed':False}
    def close(self):
        self.closing=True;self.armed=False
        try:
            if self.protocol.ready:
                try:self.exit_result=self.exit_watch(timeout=8)
                except Exception as e:
                    self.exit_result={'acknowledged':False,'error':str(e)};self.log('stop-exit',str(e))
                    try:self.transport_only('pause',timeout=.6)
                    except Exception as pause_error:self.log('stop-pause',str(pause_error))
            if self.worker:
                try:
                    if self.worker.is_alive():self.commands.put_nowait((999999,'quit',()))
                    self.worker.join(1)
                    if self.worker.is_alive():self.worker.terminate();self.worker.join(1)
                except Exception:pass
            if self.remote_owned_pids:
                # Intersect with current executable identities before killing only our new PIDs.
                try:
                    live=set(self.remote_owned_pids)&self.server_pids()
                    if live:
                        result=subprocess.run(['bash',str(ROOT/'scripts/ssh.sh'),'HISTFILE=/dev/null; export HISTFILE; kill -TERM '+ ' '.join(str(x) for x in sorted(live))],timeout=5,capture_output=True)
                        self.log('owned-server-stop',{'pids':sorted(live),'returncode':result.returncode})
                except Exception as e:self.log('owned-server-stop-error',str(e))
            for p in reversed(self.children):
                if p.poll() is None:
                    try:os.killpg(p.pid,signal.SIGTERM);p.wait(timeout=2)
                    except (ProcessLookupError,subprocess.TimeoutExpired):
                        try:os.killpg(p.pid,signal.SIGKILL)
                        except ProcessLookupError:pass
        finally:
            self.shutdown.set();self.control_ready=False;self.protocol.ready=False;self.phase='stopped';self.save()

class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads=True
    def __init__(self,path,manager):self.manager=manager;super().__init__(str(path),Handler)
class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.request.settimeout(2)
        try:
            raw=self.rfile.readline(16385)
            if len(raw)>16384:raise ValueError('request too large')
            req=json.loads(raw);m=self.server.manager;action=req.get('action')
            if action=='status':result=m.status()
            elif action=='stop':result={'stopping':True};threading.Thread(target=self.server.shutdown,daemon=True).start()
            elif action in {'command','test','smoke'}:
                if not m.control_ready:raise RuntimeError('control is not ready: '+str(m.error or m.phase))
                result=m.test() if action in {'test','smoke'} else m.execute(req.get('op'),req.get('args',{}))
            else:raise ValueError('unknown action')
            out={'ok':True,'result':result}
        except Exception as e:out={'ok':False,'error':str(e)}
        try:self.wfile.write((json.dumps(out,allow_nan=False)+'\n').encode())
        except (BrokenPipeError,OSError):pass

def request(value, timeout=300):
    with socket.socket(socket.AF_UNIX) as s:
        s.settimeout(timeout);s.connect(str(SOCKET));s.sendall((json.dumps(value)+'\n').encode());raw=b''
        while not raw.endswith(b'\n'):
            block=s.recv(65536)
            if not block:raise RuntimeError('manager disconnected')
            raw+=block
            if len(raw)>2*1024*1024:raise RuntimeError('response too large')
        return json.loads(raw)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',nargs='?',choices=['start','status','command','test','smoke','stop']);parser.add_argument('operation',nargs='?');parser.add_argument('--op');parser.add_argument('--args',default='{}');parser.add_argument('--enable',action='store_true');parser.add_argument('--serve',action='store_true');args=parser.parse_args()
    os.umask(0o077)
    if args.serve:
        if SOCKET.exists():
            try:request({'action':'status'},1);raise RuntimeError('manager already running')
            except (ConnectionRefusedError,FileNotFoundError):SOCKET.unlink()
        m=Manager(args.enable);server=Server(SOCKET,m);os.chmod(SOCKET,0o600)
        for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:threading.Thread(target=server.shutdown,daemon=True).start())
        threading.Thread(target=m.bootstrap,daemon=True).start()
        try:server.serve_forever(poll_interval=.1)
        finally:m.close();server.server_close();SOCKET.unlink(missing_ok=True)
        return 0
    if args.action=='start':
        start_end=time.monotonic()+300
        try:out=request({'action':'status'},1)
        except (OSError,RuntimeError):out=None
        if out and out.get('result',{}).get('phase') in {'error','watch-exiting'}:
            request({'action':'stop'},2)
            stop_end=min(start_end,time.monotonic()+40)
            while SOCKET.exists():
                if time.monotonic()>=stop_end:raise TimeoutError('failed manager did not stop within recovery deadline')
                time.sleep(.2)
            out=None
        if out is None:
            STATE.mkdir(parents=True,exist_ok=True);f=open(STATE/'manager.log','ab');os.chmod(f.name,0o600)
            subprocess.Popen([sys.executable,str(pathlib.Path(__file__).resolve()),'--serve']+(['--enable'] if args.enable else []),cwd=ROOT,stdout=f,stderr=f,start_new_session=True);f.close()
            end=start_end
            while True:
                try:out=request({'action':'status'},1)
                except OSError:out=None
                if out and out['result']['phase'] in {'ready','error','stopped'}:break
                if time.monotonic()>end:raise TimeoutError('manager startup deadline; inspect status/logs')
                time.sleep(.25)
        if out['result']['phase'] not in {'ready','error','stopped'}:
            end=start_end
            while out['result']['phase'] not in {'ready','error','stopped'}:
                if time.monotonic()>=end:raise TimeoutError('existing manager startup deadline')
                time.sleep(.25);out=request({'action':'status'},1)
        if args.enable and not out['result']['enabled']:raise RuntimeError('existing manager is dry-run; stop before starting --enable')
    else:out=request({'action':args.action,'op':args.op or args.operation,'args':json.loads(args.args)})
    print(json.dumps(out,allow_nan=False));return 0 if out['ok'] and not (args.action=='start' and not out['result']['controlReady']) else 1

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as e:print(json.dumps({'ok':False,'error':str(e)}));sys.exit(1)
