"""Verify own-app exact-version exit using application and P2P evidence."""
import pathlib,sys,queue,time,json,argparse,secrets
P=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(P/'relay'))
from relay import application_identity
from manager import Parts
import frida
q=queue.Queue();parts=Parts();s=None;a=None
parser=argparse.ArgumentParser()
parser.add_argument('--version',default=json.loads((P/'watch/entry/src/main/config.json').read_text())['app']['version']['name'])
parser.add_argument('--after-report',action='store_true')
args=parser.parse_args()
try:
 d=frida.get_device_manager().add_remote_device('127.0.0.1:27043');p=next(p for p in d.enumerate_processes() if p.name=='CrescentRelay');s=d.attach(p.pid);a=s.create_script((P/'build/iphone-agent.js').read_text());a.on('message',lambda m,d:q.put(m));a.load();a.exports_sync.configure(application_identity(),False);a.exports_sync.reserve()
 command={'v':1,'t':'command','session':secrets.token_hex(8),'id':1,'op':'exit','args':{'version':args.version},'ttl':15000}
 start=time.monotonic();pinged=False;sent=None
 if not args.after_report:
  a.exports_sync.command(command);sent=time.monotonic()
  print('Sent exit for own app version '+args.version,flush=True)
 else:print('Waiting for current-version report before sending exit',flush=True)
 while time.monotonic()-start<40:
  if sent and not pinged and time.monotonic()-sent>8:a.exports_sync.ping(False);pinged=True
  try:m=q.get(timeout=.5)
  except queue.Empty:continue
  e=m.get('payload',{})
  if e.get('kind')=='p2p-ack':
   print(json.dumps(e),flush=True)
   if pinged and e.get('code')==201:print('Verified P2P now reports application not running',flush=True);break
  if e.get('kind')=='managed-part':
   r=parts.receive(e['payload'])
   if r:
    print(json.dumps(r),flush=True)
    if args.after_report and not sent and r.get('data',{}).get('version')==args.version:
     time.sleep(.12)
     a.exports_sync.command(command);sent=time.monotonic()
     print('Sent exit after complete current-version report',flush=True)
 else:print('Exit not confirmed',flush=True)
finally:
 if a:
  try:a.exports_sync.release()
  except Exception:pass
 if s:s.detach()
