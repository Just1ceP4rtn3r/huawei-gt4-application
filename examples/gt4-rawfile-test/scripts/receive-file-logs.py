#!/usr/bin/env python3
"""Receive only this app's DEMO-02 BLE diagnostic reports. No phone files."""
import argparse,sys,pathlib,json,queue,time
P=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(P/'relay'))
from relay import application_identity
from manager import Parts
import frida
parser=argparse.ArgumentParser();parser.add_argument('--seconds',type=int,default=180);parser.add_argument('--case',type=int);parser.add_argument('--plan',type=pathlib.Path);parser.add_argument('--method',choices=['binary','text'],default='binary');args=parser.parse_args()
q=queue.Queue();parts=Parts();seen=set();agent=None;session=None
out=P/'build/file-ble-results.jsonl'
try:
 device=frida.get_device_manager().add_remote_device('127.0.0.1:27043')
 process=next(p for p in device.enumerate_processes() if p.name=='CrescentRelay')
 session=device.attach(process.pid);agent=session.create_script((P/'build/iphone-agent.js').read_text())
 agent.on('message',lambda m,d:(print('Adapter initialization error: '+str(m.get('description')),flush=True) if m.get('type')=='error' else None,q.put(m)));agent.load();agent.exports_sync.configure(application_identity(),False);agent.exports_sync.reserve()
 print('BLE file-log receiver ready; no mouse events enabled',flush=True)
 agent.exports_sync.ping()
 completedPages=set();sent=False;laststats=0;deadline=time.monotonic()+args.seconds
 while time.monotonic()<deadline:
  if time.monotonic()-laststats>15:
   d=agent.exports_sync.stats();print(json.dumps({'receiver':{k:d.get(k) for k in ['wireFrames','p2pPackets','routeMatches','ackSent','ackFailed','connection']}}),flush=True);laststats=time.monotonic()
  try:m=q.get(timeout=1)
  except queue.Empty:continue
  e=m.get('payload',{})
  if m.get('type')=='error':print('Adapter error: '+str(m.get('description')),flush=True)
  if e.get('kind')=='protocol-error':print('Protocol error: '+str(e.get('message')),flush=True)
  if e.get('kind')=='managed-part':
   report=parts.receive(e['payload'])
   if not report:continue
   data=report.get('data',{})
   if data.get('test')!='DEMO-02' or data.get('version')!='1.6.38':continue
   key=json.dumps(data,sort_keys=True)
   if key not in seen:
    seen.add(key);entry={'receivedAt':time.time(),'origin':'live-watch-ble','data':data}
    with out.open('a') as f:f.write(json.dumps(entry,ensure_ascii=False)+'\n')
    print(json.dumps(entry,ensure_ascii=False),flush=True)
   if (args.case is not None or args.plan is not None) and not sent:
    agent.exports_sync.command({'v':1,'t':'command','session':'de02000000000001','id':1,'op':'test','args':({'ops':json.loads(args.plan.read_text())} if args.plan else {'pathIndex':args.case,'method':args.method}),'ttl':15000});sent=True
   elif data.get('file',{}).get('phase') in ('complete','verified'):
    completedPages.add(data.get('page',0))
    if data.get('pages',0)>0 and len(completedPages)>=data['pages']:break
 else:print('Receiver deadline; no verified result observed',flush=True)
finally:
 if agent:
  try:agent.exports_sync.release()
  except Exception:pass
 if session:session.detach()
