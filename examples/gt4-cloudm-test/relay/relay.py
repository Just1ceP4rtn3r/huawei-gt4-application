#!/usr/bin/env python3
"""Existing iPhone P2P -> bounded NDJSON pipe -> local macOS event sink. No phone files."""
import argparse
import base64
import datetime
import hashlib
import json
import pathlib
import queue
import re
import signal
import subprocess
import sys
import threading
import time
import frida
from watch_logs import WatchLogs

PROJECT=pathlib.Path(__file__).resolve().parents[1]
ROOT=PROJECT.parents[1]

def application_identity():
    signing=ROOT/'.local/signing'
    csr=subprocess.check_output(['openssl','req','-in',str(signing/'gt4counter.csr'),'-pubkey','-noout'])
    chain=re.findall(rb'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----',(signing/'gt4counter-debug.cer').read_bytes(),re.S)
    leaf=[c for c in chain if subprocess.check_output(['openssl','x509','-pubkey','-noout'],input=c)==csr]
    if len(leaf)!=1: raise ValueError('Cannot identify local watch signing certificate; use --watch-fingerprint')
    der=subprocess.check_output(['openssl','x509','-outform','DER'],input=leaf[0])
    public_der=subprocess.check_output(['openssl','pkey','-pubin','-outform','DER'],input=csr)
    # Existing signing key is NIST P-256. SecKey external form/appverify GetAppid uses the raw EC point.
    if len(public_der)!=91 or public_der[-65]!=4:raise ValueError('Expected P-256 public key')
    bundle=json.loads((PROJECT/'watch/entry/src/main/config.json').read_text())['app']['bundleName']
    return bundle+'_'+base64.b64encode(public_der[-65:]).decode()

def run(args):
    executable=PROJECT/'build/GT4AirPointerSink'
    agent_path=PROJECT/'build/iphone-agent.js'
    if not executable.is_file() or not agent_path.is_file():raise ValueError('Run scripts/build.sh first')
    fingerprint=args.watch_fingerprint or application_identity()
    if not re.fullmatch(r'[A-Za-z0-9.]+_[A-Za-z0-9+/]{87}=',fingerprint):raise ValueError('Expected bundle + base64 of the actual P-256 developer public key')
    report={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mouseEnabled':args.enable,'receivedFrames':0,'armedFrames':0,'motionAbsX':0,'motionAbsY':0,'buttons':[],'latestDiagnostics':None,'latestDesktopReceipt':None}
    def save_report():
        (PROJECT/'build/device-validation.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    save_report()
    pending=queue.Queue(maxsize=4)
    stopped=threading.Event()
    def stop(*_):stopped.set()
    signal.signal(signal.SIGINT,stop)
    signal.signal(signal.SIGTERM,stop)
    child=subprocess.Popen([str(executable),'--enable' if args.enable else '--dry-run'],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    desktop_receipt=[None]
    def read_desktop():
        for raw in child.stdout:
            try:
                value=json.loads(raw)
                if value.get('t')=='desktop':desktop_receipt[0]=(time.monotonic(),value)
            except (ValueError,UnicodeError):pass
    threading.Thread(target=read_desktop,daemon=True).start()
    session=None
    agent=None
    reserved=False
    watch_logs=WatchLogs()
    watch_log_path=PROJECT/'build/watch-diagnostics.ndjson'
    def message(m,_):
        if m.get('type')=='error':
            print('iPhone adapter error: '+m.get('description','unknown'),file=sys.stderr);stopped.set();return
        data=m.get('payload',{})
        if data.get('kind')=='protocol-error':
            print('P2P error: '+data.get('message','unknown'),file=sys.stderr);return
        if data.get('kind')=='watch-log-part':
            try:
                part=data['payload']
                result=watch_logs.receive(part)
                print('Watch log BLE part: '+str(part['part'])+'/'+str(part['total']),file=sys.stderr)
                if result is not None:
                    result['receivedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
                    with watch_log_path.open('a') as output:output.write(json.dumps(result,separators=(',',':'))+'\n')
                    print('Watch native diagnostics: '+json.dumps(result,separators=(',',':')),file=sys.stderr)
            except (ValueError,KeyError,TypeError) as error:print('Watch log rejected: '+str(error),file=sys.stderr)
            return
        if data.get('kind')!='pointer':return
        # Drop stale motion under backpressure. Button IDs are repeated by watch and deduplicated by sink.
        item=(time.monotonic(),data['payload'])
        try:pending.put_nowait(item)
        except queue.Full:
            try:pending.get_nowait()
            except queue.Empty:pass
            try:pending.put_nowait(item)
            except queue.Full:pass
    try:
        time.sleep(0.1)
        if child.poll() is not None:raise RuntimeError('Desktop sink refused to start (check Accessibility permission)')
        device=frida.get_device_manager().add_remote_device('127.0.0.1:27043')
        processes=[p for p in device.enumerate_processes() if p.name=='CrescentRelay']
        if len(processes)!=1:raise RuntimeError('Unlock iPhone and open the matching CrescentRelay version')
        session=device.attach(processes[0].pid)
        agent=session.create_script(agent_path.read_text())
        agent.on('message',message)
        agent.load()
        agent.exports_sync.configure(fingerprint,args.enable)
        agent.exports_sync.reserve()
        reserved=True
        if args.probe:
            agent.exports_sync.ping()
            print('Sent a bounded P2P ping to the installed AirPointer package',file=sys.stderr)
        if args.probe_data:
            agent.exports_sync.probe_data()
            print('Sent non-input data probe (sequence 98)',file=sys.stderr)
        print('Relay ready ('+('MOUSE ENABLED' if args.enable else 'dry-run')+'). Watch: main-page Connect. Ctrl-C stops.',file=sys.stderr)
        status_at=0
        stats_at=0
        count=0
        while not stopped.is_set():
            if time.monotonic()-stats_at>10:
                print('P2P diagnostics: '+json.dumps(agent.exports_sync.stats(),separators=(',',':')),file=sys.stderr)
                stats_at=time.monotonic()
            if child.poll() is not None:raise RuntimeError('Desktop sink exited')
            try:
                received,frame=pending.get(timeout=0.1)
            except queue.Empty:continue
            if time.monotonic()-received>0.2:continue
            encoded=json.dumps(frame,separators=(',',':'),allow_nan=False)
            if len(encoded)>4096:raise ValueError('Pointer message exceeds budget')
            child.stdin.write((encoded+'\n').encode())
            child.stdin.flush()
            count+=1
            report['receivedFrames']=count
            report['armedFrames']+=int(frame.get('armed') is True)
            report['motionAbsX']+=abs(frame.get('dx',0))
            report['motionAbsY']+=abs(frame.get('dy',0))
            report['latestDiagnostics']=frame.get('diag')
            receipt=desktop_receipt[0]
            desktop_alive=(receipt and time.monotonic()-receipt[0]<0.5 and receipt[1].get('session')==frame.get('session'))
            if desktop_alive and time.monotonic()-status_at>=1:
                report['latestDesktopReceipt']=receipt[1]
                save_report()
                agent.exports_sync.status()
                status_at=time.monotonic()
                print('Pointer frames received: '+str(count),file=sys.stderr)
    finally:
        if agent and reserved:
            try:agent.exports_sync.release()
            except Exception as e:print('Adapter release: '+str(e),file=sys.stderr)
        if session:
            try:session.detach()
            except Exception:pass
        if child.stdin:child.stdin.close()
        try:child.wait(timeout=2)
        except subprocess.TimeoutExpired:child.terminate();child.wait(timeout=2)
        report['endedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
        save_report()
        print('Relay stopped; desktop releases drag. Existing SSH/server processes are not owned by this script.',file=sys.stderr)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--probe-data',action='store_true',help='One non-input app data probe')
    parser.add_argument('--probe',action='store_true',help='Send one P2P presence ping to this app')
    parser.add_argument('--enable',action='store_true',help='Explicitly enable macOS cursor and button injection')
    parser.add_argument('--watch-fingerprint',help='Exact Lite P2P identity: bundle + underscore + base64 of developer EC public point')
    options=parser.parse_args()
    try:run(options)
    except Exception as error:print(str(error),file=sys.stderr);sys.exit(1)
