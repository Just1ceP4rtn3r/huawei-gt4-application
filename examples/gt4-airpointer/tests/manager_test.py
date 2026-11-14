"""Offline only: no Frida import, SSH, phone or watch access."""
import importlib.util
import json
import pathlib
import unittest
import threading
import queue
from types import SimpleNamespace
from unittest import mock
p=pathlib.Path(__file__).resolve().parents[1]/'relay/manager.py'
spec=importlib.util.spec_from_file_location('gt4manager',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def event(kind='ready',seq=1,**kw):
    return dict(v=1,t='rpc',boot='1234abcd',seq=seq,event=kind,session='',id=0,data={},**kw)
class FakeManager(m.Manager):
    def __init__(self, outcome):
        self.protocol=m.Protocol();self.protocol.event(event());self.condition=threading.Condition()
        self.command_lock=threading.RLock();self.shutdown=threading.Event();self.pending=None
        self.acks={};self.armed=False;self.outcome=outcome;self.dispatch_lock=threading.Lock()
        self.origin_counts={};self.backend_counts={};self.latest_pointer=None;self.synthetic_pointer=None;self.desktop_receipt=None
        self.pointer_activity_session=None;self.pointer_activity_seq=0;self.pointer_activity_offset=None;self.pointer_retired=[];self.last_pointer_activity=None
    def log(self,*_):pass
    def save(self):pass
    def rpc(self,method,command,**_):
        if self.outcome is not None:
            self.acks[(command['session'],command['id'])]={'data':self.outcome}
        return {'sequence':12,'code':207}

class Tests(unittest.TestCase):
    def test_reassembly_order_duplicates(self):
        r=m.Parts();s=json.dumps(event(),separators=(',',':'));pieces=[s[i:i+48] for i in range(0,len(s),48)]
        result=None
        for i in reversed(range(len(pieces))):result=r.receive(dict(session='aabbccdd',part=i+1,total=len(pieces),text=pieces[i]))
        self.assertEqual(result,event());self.assertFalse(r.pending)
    def test_bounds_and_conflicts(self):
        r=m.Parts()
        with self.assertRaises(ValueError):r.receive(dict(session='aabbccdd',part=1,total=21,text='x'))
        r.receive(dict(session='aabbccdd',part=1,total=2,text='a'))
        with self.assertRaises(ValueError):r.receive(dict(session='aabbccdd',part=1,total=2,text='b'))
        self.assertFalse(r.pending)
    def test_expiry(self):
        r=m.Parts();r.receive(dict(session='aabbccdd',part=1,total=2,text='a'),now=0)
        r.receive(dict(session='11223344',part=1,total=2,text='b'),now=46)
        self.assertNotIn('aabbccdd',r.pending)
    def test_ready_is_application_event(self):
        p=m.Protocol()
        with self.assertRaises(RuntimeError):p.command('hello',{})
        with self.assertRaises(ValueError):p.event(dict(kind='p2p-ack',code=202))
        self.assertFalse(p.ready);self.assertTrue(p.event(event()))
        self.assertFalse(p.event(event()))
        a=p.command('hello',{'enabled':True});b=p.command('arm',{'enabled':True})
        self.assertFalse(a['args']['enabled']);self.assertFalse(b['args']['enabled']);self.assertEqual(b['id'],a['id']+1)
        self.assertEqual(b['args']['lease'],1500)
    def test_ack_error_not_success(self):
        p=m.Protocol();p.event(event());c=p.command('probe',{})
        value=dict(v=1,t='rpc',boot='1234abcd',seq=2,event='ack',session=c['session'],id=c['id'],data={'ok':False,'error':'unsupported'})
        p.event(value);self.assertIs(value['data']['ok'],False)
        self.assertNotEqual(c['session'],'');self.assertEqual(len(c['session']),16)
    def test_executor_error_and_success(self):
        with self.assertRaisesRegex(RuntimeError,'unsupported'):
            FakeManager({'ok':False,'error':'unsupported'}).execute('probe',{'api':'legacy'})
        result=FakeManager({'ok':True,'result':{'samples':12}}).execute('status')
        self.assertEqual(result['ack']['data']['result']['samples'],12)
    def test_transport_ack_does_not_complete_command(self):
        manager=FakeManager(None)
        with mock.patch.object(m.time,'monotonic',side_effect=[0,36]):
            with self.assertRaisesRegex(TimeoutError,'application ack timeout'):
                manager.execute('status')
        self.assertIsNone(manager.pending)
    def test_heartbeat_is_transport_only(self):
        manager=FakeManager(None)
        class NoCommandLock:
            def acquire(self,**_):raise AssertionError('heartbeat must not use app command lock')
        manager.command_lock=NoCommandLock()
        result=manager.transport_only('heartbeat',{'enabled':True})
        self.assertEqual(result['code'],207);self.assertFalse(manager.acks)
        self.assertEqual(manager.protocol.command_id,1)
    def test_arm_heartbeat_enabled_before_ack(self):
        manager=FakeManager({'ok':True});manager.protocol.enabled=True;observed=[]
        original=manager.rpc
        def rpc(*a,**kw):observed.append(manager.armed);return original(*a,**kw)
        manager.rpc=rpc;manager.execute('arm')
        self.assertEqual(observed,[True])
    def test_sessions_and_version(self):
        p=m.Protocol();ready=event();ready['data']={'version':'1.1.8'};p.event(ready)
        self.assertEqual(p.version,'1.1.8')
        with self.assertRaisesRegex(ValueError,'session'):
            p.event(dict(v=1,t='rpc',boot='1234abcd',seq=2,event='ack',session='wrong',id=1,data={'ok':True}))
    def test_pid_ownership_parser(self):
        self.assertEqual(m.Manager.parse_server_pids('PID COMM\n 123 /var/jb/usr/sbin/frida-server\n 456 /bin/ssh\n'),{123})
    def test_close_releases_worker_after_pause(self):
        manager=FakeManager(None);manager.remote_owned_pids=[];manager.children=[];calls=[]
        class Worker:
            alive=True
            def is_alive(self):return self.alive
            def join(self,_):self.alive=False
            def terminate(self):calls.append('terminate')
        class Commands:
            def put_nowait(self,value):calls.append(value[1])
        manager.worker=Worker();manager.commands=Commands()
        def exit_watch(**kw):
            self.assertFalse(manager.shutdown.is_set());calls.append('exit');return {'acknowledged':True}
        manager.exit_watch=exit_watch;manager.close()
        self.assertEqual(calls,['exit','quit']);self.assertTrue(manager.shutdown.is_set())
    def test_probe_nested_error_is_failure(self):
        manager=FakeManager({'ok':True,'result':{'ok':False,'error':'native failed','ready':True}})
        with mock.patch.object(manager.shutdown,'wait',return_value=False):result=manager.test()
        probes=[s for s in result['steps'] if s['op']=='probe']
        self.assertEqual(len(probes),2);self.assertTrue(all(s['ok'] is False for s in probes))
        self.assertEqual(result['steps'][-1]['op'],'pause')
    def test_phone_bootstrap_restores_idle_before_return(self):
        calls=[]
        class Exports:
            count=0
            def prepare(self):calls.append('prepare');return {'phase':'scanning','ready':False}
            def step(self):
                self.count+=1;calls.append('step')
                return {'phase':'ready' if self.count==2 else 'connecting','ready':self.count==2,'paired':self.count==2,'secret':'must not be emitted'}
            def release(self):calls.append('release')
        class Script:
            exports_sync=Exports()
            def load(self):calls.append('load')
            def unload(self):calls.append('unload')
        class Session:
            def create_script(self,_):return Script()
        events=queue.Queue()
        with mock.patch.object(pathlib.Path,'read_text',return_value='bootstrap'),mock.patch.object(m.time,'sleep'):
            result=m.bootstrap_phone(Session(),events)
        self.assertTrue(result['ready']);self.assertEqual(calls[-2:],['release','unload'])
        while not events.empty():self.assertNotIn('secret',events.get()['payload']['payload'])
    def test_phone_bootstrap_timeout_never_loads_adapter(self):
        calls=[]
        class Exports:
            def prepare(self):return {'phase':'connecting','ready':False}
            def step(self):calls.append('step');return {'phase':'connecting','ready':False}
            def release(self):calls.append('release')
        class Script:
            exports_sync=Exports()
            def load(self):calls.append('bootstrap-load')
            def unload(self):calls.append('unload')
        class Session:
            def create_script(self,_):return Script()
        with mock.patch.object(pathlib.Path,'read_text',return_value='bootstrap'),mock.patch.object(m.time,'monotonic',side_effect=[0,46]):
            with self.assertRaisesRegex(TimeoutError,'bootstrap deadline'):m.bootstrap_phone(Session(),queue.Queue())
        self.assertEqual(calls,['bootstrap-load','release','unload'])
    def test_exact_crescent_restart_only(self):
        result=lambda stdout=b'':SimpleNamespace(returncode=0,stdout=stdout)
        with mock.patch.object(m.subprocess,'run',side_effect=[result(b'PID COMM\n42 /Applications/CrescentRelay.app/CrescentRelay\n'),result(),result()]) as run:
            m.restart_crescent(42)
        commands=[c.args[0][-1] for c in run.call_args_list]
        self.assertIn('kill -TERM 42',commands[1]);self.assertIn('uiopen --bundleid local.gt4bridge.crescent',commands[2])
        with mock.patch.object(m.subprocess,'run',return_value=result(b'42 /bin/other\n')) as run:
            with self.assertRaisesRegex(RuntimeError,'refusing'):m.restart_crescent(42)
            self.assertEqual(run.call_count,1)
    def test_phone_recovery_once_and_detach_order(self):
        order=[]
        class Session:
            def __init__(self,pid):self.pid=pid
            def detach(self):order.append(('detach',self.pid))
        class Device:
            count=0
            def enumerate_processes(self):self.count+=1;return [SimpleNamespace(name='CrescentRelay',pid=self.count)]
            def attach(self,pid):order.append(('attach',pid));return Session(pid)
        def bootstrap(session,*a,**kw):
            if session.pid==1:raise TimeoutError('not ready')
        with mock.patch.object(m,'bootstrap_phone',side_effect=bootstrap),mock.patch.object(m,'restart_crescent',side_effect=lambda pid:order.append(('restart',pid))):
            session=m.attach_phone(Device(),queue.Queue(),m.time.monotonic()+115)
        self.assertEqual(session.pid,2)
        self.assertEqual(order,[('attach',1),('detach',1),('restart',1),('attach',2)])
        with mock.patch.object(m,'bootstrap_phone',side_effect=TimeoutError('not ready')),mock.patch.object(m,'restart_crescent') as restart:
            with self.assertRaises(TimeoutError):m.attach_phone(Device(),queue.Queue(),m.time.monotonic()+115)
            self.assertEqual(restart.call_count,1)
    def test_pointer_queue_and_probe_separation(self):
        manager=FakeManager(None);manager.lock=threading.RLock();manager.pointer_queue=queue.Queue(4)
        manager.pointer_received=0;manager.armed_frames=0;manager.motion_abs={'x':0,'y':0};manager.pointer_dropped=0
        frame={'v':1,'t':'pointer','session':'123-456','seq':1,'sent':1000,'armed':True,'dx':2,'dy':-3,'scroll':0,'buttons':[]}
        self.assertFalse(manager.receive_pointer(dict(frame,t='probe')))
        self.assertFalse(manager.receive_pointer(dict(frame,dx=float('nan'))))
        for seq in range(1,7):self.assertTrue(manager.receive_pointer(dict(frame,seq=seq)))
        self.assertEqual(manager.pointer_queue.qsize(),4);self.assertEqual(manager.pointer_dropped,2)
        self.assertEqual(manager.pointer_received,6);self.assertEqual(manager.motion_abs,{'x':12,'y':18})
        self.assertEqual(manager.pointer_queue.get()[1]['seq'],3)
    def test_desktop_receipt_requires_fresh_matching_session(self):
        manager=FakeManager(None);frame={'session':'123-456'}
        manager.desktop_receipt=(10,{'t':'desktop','session':'other'})
        self.assertFalse(manager.receipt_fresh(frame,10.1))
        manager.desktop_receipt=(10,{'t':'desktop','session':'123-456'})
        self.assertTrue(manager.receipt_fresh(frame,10.49));self.assertFalse(manager.receipt_fresh(frame,10.5))
    def test_exit_requires_application_ack(self):
        manager=FakeManager({'ok':True,'result':{'exiting':True}})
        self.assertTrue(manager.exit_watch()['acknowledged'])
        manager=FakeManager(None)
        with mock.patch.object(m.time,'monotonic',side_effect=[0,9]):
            with self.assertRaisesRegex(TimeoutError,'exit application ACK'):manager.exit_watch()
    def live_manager(self):
        manager=FakeManager({'ok':True});manager.parts=m.Parts();manager.lock=threading.RLock()
        manager.protocol.cycle=1;manager.protocol.last_seq=1;manager.control_ready=True
        manager.bootstrap_complete=True;manager.closing=False;manager.exiting=False;manager.recovering=False
        manager.lifecycle_generation=0;manager.app_ready=threading.Event();manager.last_event=None
        manager.last_managed_part=0;manager.phone_acks=[];manager.phase='ready';manager.error=None;manager.silence_running=False
        return manager
    def deliver(self,manager,value):
        text=json.dumps(value,separators=(',',':'));pieces=[text[i:i+48] for i in range(0,len(text),48)]
        for i,piece in enumerate(pieces):manager.handle({'type':'send','payload':{'kind':'managed-part','payload':{'session':'aabbccdd','part':i+1,'total':len(pieces),'text':piece}}})
    def test_periodic_ready_vs_lifecycle_recovery(self):
        manager=self.live_manager();manager.pending={'session':manager.protocol.session,'id':40}
        with mock.patch.object(manager,'schedule_recovery') as schedule:
            self.deliver(manager,dict(v=1,t='rpc',boot='1234abcd',seq=2,event='ready',session='',id=0,data={'cycle':1}))
            schedule.assert_not_called();self.assertTrue(manager.control_ready)
            self.deliver(manager,dict(v=1,t='rpc',boot='1234abcd',seq=3,event='ready',session='',id=0,data={'cycle':2}))
            schedule.assert_called_once();self.assertFalse(manager.control_ready);self.assertFalse(manager.armed)
            self.assertFalse(manager.acks[(manager.protocol.session,40)]['data']['ok'])
    def test_boot_change_recovers_but_initial_bootstrap_owns_handshake(self):
        manager=self.live_manager()
        with mock.patch.object(manager,'schedule_recovery') as schedule:
            self.deliver(manager,dict(v=1,t='rpc',boot='deadbeef',seq=1,event='ready',session='',id=0,data={'cycle':1}))
            schedule.assert_called_once();self.assertFalse(manager.control_ready)
        manager=self.live_manager();manager.bootstrap_complete=False
        with mock.patch.object(manager,'schedule_recovery') as schedule:
            self.deliver(manager,dict(v=1,t='rpc',boot='1234abcd',seq=2,event='ready',session='',id=0,data={'cycle':2}))
            schedule.assert_not_called()
    def test_partial_beacon_counts_as_activity(self):
        manager=self.live_manager()
        with mock.patch.object(m.time,'monotonic',return_value=99):
            manager.handle({'type':'send','payload':{'kind':'managed-part','payload':{'session':'aabbccdd','part':1,'total':2,'text':'{'}}})
        self.assertEqual(manager.last_managed_part,99)
    def test_recovery_serial_handshake_and_no_armed_restore(self):
        manager=self.live_manager();manager.control_ready=False;manager.recovering=True;calls=[]
        def execute(op,args=None):calls.append(op);return {'ack':{'data':{'ok':True}}}
        manager.execute=execute;manager.recovery_loop()
        self.assertEqual(calls,['hello','status']);self.assertTrue(manager.control_ready)
        self.assertFalse(manager.armed);self.assertFalse(manager.recovering)
    def test_silence_ping_bound_does_not_fake_ready(self):
        manager=self.live_manager();manager.silence_running=True
        with mock.patch.object(manager.app_ready,'wait',return_value=False),mock.patch.object(manager,'rpc',return_value={'code':202}) as rpc:
            manager.silence_recovery()
        self.assertEqual(rpc.call_count,3);self.assertFalse(manager.control_ready)
        self.assertEqual(manager.phase,'error');self.assertFalse(manager.protocol.ready)
    def test_start_replaces_error_daemon_once(self):
        error={'ok':True,'result':{'phase':'error','enabled':False,'controlReady':False}}
        ready={'ok':True,'result':{'phase':'ready','enabled':False,'controlReady':True}}
        with mock.patch.object(m.sys,'argv',['manager.py','start']),mock.patch.object(m,'request',side_effect=[error,{'ok':True},ready]) as request, mock.patch.object(pathlib.Path,'exists',return_value=False),mock.patch.object(pathlib.Path,'mkdir'),mock.patch('builtins.open',mock.mock_open()),mock.patch.object(m.os,'chmod'),mock.patch.object(m.subprocess,'Popen') as spawn,mock.patch('builtins.print'):
            self.assertEqual(m.main(),0)
        self.assertEqual(spawn.call_count,1)
        self.assertEqual([c.args[0]['action'] for c in request.call_args_list],['status','stop','status'])
    def test_start_never_spawns_over_failed_stop(self):
        error={'ok':True,'result':{'phase':'error','enabled':False,'controlReady':False}}
        with mock.patch.object(m.sys,'argv',['manager.py','start']),mock.patch.object(m,'request',side_effect=[error,{'ok':True}]),mock.patch.object(pathlib.Path,'exists',return_value=True),mock.patch.object(m.time,'monotonic',side_effect=[0,0,41]),mock.patch.object(m.subprocess,'Popen') as spawn:
            with self.assertRaisesRegex(TimeoutError,'did not stop'):m.main()
        spawn.assert_not_called()
    def test_pushed_wire_stats_filters_private_fields(self):
        manager=self.live_manager()
        raw={'p2pPackets':3,'lastHeaders':['private'],'keys':['private'],'connection':{'ready':True,'paired':False,'secret':'private'},'wireTail':[{'event':'frame','length':4,'payload':'private'}],'frameFlags':{'0':4,'bad':'private'}}
        with mock.patch.object(m,'private_json') as write,mock.patch.object(m.time,'monotonic',return_value=20):
            manager.handle({'type':'send','payload':{'kind':'wire-stats','payload':raw}})
        self.assertEqual(manager.last_wire_stats,20)
        self.assertEqual(manager.wire_stats['connection'],{'ready':True,'paired':False})
        self.assertEqual(manager.wire_stats['wireTail'],[{'event':'frame','length':4}])
        self.assertEqual(manager.wire_stats['frameFlags'],{'0':4})
        self.assertNotIn('lastHeaders',manager.wire_stats);self.assertNotIn('keys',manager.wire_stats)
        write.assert_called_once()
    def test_monitor_never_polls_stats_or_kills_worker(self):
        manager=self.live_manager();manager.worker=mock.Mock();manager.worker.is_alive.return_value=True
        manager.phone_attached_at=0;manager.last_wire_stats=0;manager.last_foreground_attempt=None;manager.foreground_running=False
        manager.last_managed_part=35
        with mock.patch.object(m.time,'monotonic',return_value=11),mock.patch.object(m.threading,'Thread') as thread,mock.patch.object(manager,'rpc') as rpc:
            manager.monitor_local();thread.assert_called_once()
        self.assertEqual(manager.last_foreground_attempt,11);self.assertTrue(manager.control_ready)
        manager.foreground_running=False
        with mock.patch.object(m.time,'monotonic',return_value=20),mock.patch.object(m.threading,'Thread') as thread:
            manager.monitor_local();thread.assert_not_called()
        with mock.patch.object(m.time,'monotonic',return_value=31),mock.patch.object(m.threading,'Thread'):
            manager.monitor_local()
        self.assertEqual(manager.phase,'error');self.assertFalse(manager.control_ready)
        manager.worker.terminate.assert_not_called();rpc.assert_not_called()
    def test_stats_loop_only_monitors_local(self):
        manager=self.live_manager()
        with mock.patch.object(manager.shutdown,'wait',side_effect=[False,True]),mock.patch.object(manager,'monitor_local') as monitor,mock.patch.object(manager,'rpc') as rpc:
            manager.stats_loop()
        monitor.assert_called_once();rpc.assert_not_called()
    def test_pointer_origin_backend_summary(self):
        manager=self.live_manager();manager.pointer_queue=queue.Queue(4);manager.pointer_received=0;manager.armed_frames=0;manager.pointer_dropped=0;manager.motion_abs={'x':0,'y':0}
        frame={'v':1,'t':'pointer','session':'1-2','seq':9,'sent':1,'armed':True,'dx':4,'dy':0,'scroll':0,'buttons':[],'origin':'synthetic-watch-test','backend':'experimental-ping'}
        manager.receive_pointer(frame)
        self.assertEqual(manager.origin_counts,{'synthetic-watch-test':1});self.assertEqual(manager.backend_counts,{'experimental-ping':1})
        self.assertNotIn('session',manager.latest_pointer);self.assertEqual(manager.synthetic_pointer[1]['seq'],9)
    def test_cursor_evidence_requires_enabled_receipt_and_movement(self):
        manager=self.live_manager();manager.protocol.enabled=True
        manager.synthetic_pointer=(11,{'session':'1-2','seq':9,'armed':True})
        manager.desktop_receipt=(12,{'t':'desktop','session':'1-2','seq':9,'enabled':True})
        evidence={'started':10,'beforeCursor':{'x':10,'y':20},'beforeReceipt':None}
        with mock.patch.object(manager,'cursor_position',return_value={'x':14,'y':20}):
            result=manager.finish_cursor_test(evidence)
        self.assertTrue(result['ok']);self.assertEqual(result['syntheticSeq'],9)
        manager.protocol.enabled=False
        with mock.patch.object(manager,'cursor_position',return_value={'x':14,'y':20}):self.assertFalse(manager.finish_cursor_test(evidence)['ok'])
        manager.synthetic_pointer=None
        with mock.patch.object(m.time,'monotonic',return_value=19),mock.patch.object(manager,'cursor_position',return_value={'x':14,'y':20}):self.assertFalse(manager.finish_cursor_test(evidence)['ok'])
    def test_exit_updates_lifecycle(self):
        manager=self.live_manager();manager.execute('exit')
        self.assertEqual(manager.phase,'watch-exiting');self.assertFalse(manager.control_ready);self.assertFalse(manager.protocol.ready)
        self.assertTrue(manager.exit_result['acknowledged']);self.assertFalse(manager.exit_result['terminationConfirmed'])
    def test_wire_connection_false_invalidates_ready(self):
        manager=self.live_manager()
        with mock.patch.object(m,'private_json'):
            manager.handle({'type':'send','payload':{'kind':'wire-stats','payload':{'connection':{'sameGeneration':False,'paired':True,'ready':True}}}})
        self.assertEqual(manager.phase,'error');self.assertFalse(manager.control_ready);self.assertFalse(manager.protocol.ready)
    def test_only_fresh_advancing_pointer_renews_activity(self):
        manager=self.live_manager()
        frame={'session':'1-2','seq':1,'sent':100000,'origin':'real-sensor','backend':'experimental-ping'}
        with mock.patch.object(m.time,'time',return_value=100),mock.patch.object(m.time,'monotonic',return_value=10):
            self.assertFalse(manager.record_pointer_activity(frame))
        with mock.patch.object(m.time,'time',return_value=100.1),mock.patch.object(m.time,'monotonic',return_value=11):
            self.assertFalse(manager.record_pointer_activity(frame))
            self.assertFalse(manager.record_pointer_activity(dict(frame,seq=2,sent=99000)))
            self.assertFalse(manager.record_pointer_activity(dict(frame,seq=2,sent=97000)))
            self.assertFalse(manager.record_pointer_activity(dict(frame,seq=2,origin='probe')))
            self.assertFalse(manager.record_pointer_activity(dict(frame,seq=2,backend='unknown')))
        self.assertIsNone(manager.last_pointer_activity)
        with mock.patch.object(m.time,'time',return_value=100.2),mock.patch.object(m.time,'monotonic',return_value=12):
            self.assertTrue(manager.record_pointer_activity(dict(frame,seq=2,sent=102000)))
            self.assertFalse(manager.record_pointer_activity(dict(frame,session='3-4',seq=1,sent=102000)))
            self.assertFalse(manager.record_pointer_activity(dict(frame,seq=3,sent=100200)))
        self.assertEqual(manager.last_pointer_activity,12)
    def test_pointer_stream_prevents_false_managed_silence(self):
        manager=self.live_manager();manager.worker=mock.Mock();manager.worker.is_alive.return_value=True
        manager.phone_attached_at=0;manager.last_wire_stats=30;manager.last_foreground_attempt=None;manager.foreground_running=False
        manager.last_managed_part=0;manager.last_pointer_activity=29
        with mock.patch.object(m.time,'monotonic',return_value=30),mock.patch.object(m.threading,'Thread') as thread:
            manager.monitor_local();thread.assert_not_called()
        with mock.patch.object(m.time,'monotonic',return_value=50),mock.patch.object(m.threading,'Thread') as thread:
            manager.last_wire_stats=50;manager.monitor_local();thread.assert_called_once()
    def test_unknown_boot_rejected(self):
        p=m.Protocol();p.event(event())
        with self.assertRaises(ValueError):p.event(dict(v=1,t='rpc',boot='deadbeef',seq=1,event='state',session='',id=0,data={}))
if __name__=='__main__':unittest.main()
