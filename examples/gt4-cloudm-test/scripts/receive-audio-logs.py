"""Receive Cloudm logs via existing memory-only BLE adapter; no phone files."""
import sys,pathlib,json,queue,time,argparse
P=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(P/'relay'))
from relay import application_identity
from manager import Parts
import frida
parser=argparse.ArgumentParser()
parser.add_argument('--duration',type=int,default=600)
parser.add_argument('--health-compatible',action='store_true')
args=parser.parse_args()
if not 10<=args.duration<=600:parser.error('duration must be 10..600 seconds')
q=queue.Queue();parts=Parts();chunks={};agent=None;session=None
counts={'managedParts':0,'completeReports':0,'currentReports':0}
out=P/'build/audio-ble-results.jsonl'
if out.exists():
 for line in out.read_text().splitlines():
  d=json.loads(line)['data']
  if 'pages' in d:chunks.setdefault((d['run'],d['pages']),{})[d['page']]=d['text']
try:
 device=frida.get_device_manager().add_remote_device('127.0.0.1:27043')
 process=next(p for p in device.enumerate_processes() if p.name=='CrescentRelay')
 session=device.attach(process.pid);agent=session.create_script((P/'build/iphone-agent.js').read_text())
 agent.on('message',lambda m,d:q.put(m));agent.load();agent.exports_sync.configure(application_identity(),False);agent.exports_sync.reserve();agent.exports_sync.ping(args.health_compatible)
 print('BLE receiver ready; waiting for Cloudm foreground',flush=True)
 deadline=time.monotonic()+args.duration
 next_ping=time.monotonic()+15;attempts=1;got_current=False
 while time.monotonic()<deadline:
  if not got_current and attempts<3 and time.monotonic()>=next_ping:
   print('P2P ping retry',attempts,flush=True);agent.exports_sync.ping(args.health_compatible);attempts+=1;next_ping=time.monotonic()+15
  try:m=q.get(timeout=1)
  except queue.Empty:continue
  if m.get('type')=='error':print(m.get('description'),flush=True);continue
  e=m.get('payload',{})
  if e.get('kind') in ('p2p-ack','protocol-status','protocol-error') or (e.get('kind')=='app-header' and e.get('payload',{}).get('kind')==3):print(json.dumps(e),flush=True)
  if e.get('kind')!='managed-part':continue
  counts['managedParts']+=1
  r=parts.receive(e['payload'])
  if not r:continue
  d=r.get('data',{})
  if d.get('test')!='CLOUDM-AUDIO':continue
  counts['completeReports']+=1
  current=d.get('version')==json.loads((P/'watch/entry/src/main/config.json').read_text())['app']['version']['name']
  if current:got_current=True;counts['currentReports']+=1
  with out.open('a') as f:f.write(json.dumps({'receivedAt':time.time(),'origin':'live-watch-ble','data':d},ensure_ascii=False)+'\n')
  if 'pages' not in d:
   print(json.dumps(d),flush=True)
   if not current:continue
   (P/'build/audio-latest-summary.json').write_text(json.dumps(d,indent=2)+'\n')
   if d.get('phase') in ('test-complete','failed'):break
   continue
  key=(d['run'],d['pages']);c=chunks.setdefault(key,{});c[d['page']]=d['text']
  print('pages',len(c),'/',d['pages'],flush=True)
  if len(c)==d['pages']:
   text=''.join(c[i] for i in range(d['pages']))
   (P/'build/audio-watch-log.txt').write_text(text)
   print('Complete BLE log saved, bytes='+str(len(text)),flush=True)
   break
 else:print('Deadline: no complete device log',flush=True)
finally:
 print('Reception counts '+json.dumps(counts),flush=True)
 if agent:
  try:
   stats=agent.exports_sync.stats()
   print('Transport counts '+json.dumps({k:stats.get(k) for k in ('p2pPackets','routeMatches','ackSent','ackFailed','connection')}),flush=True)
  except Exception as e:print('Transport stats unavailable: '+type(e).__name__,flush=True)
  try:agent.exports_sync.release()
  except Exception:pass
 if session:session.detach()
