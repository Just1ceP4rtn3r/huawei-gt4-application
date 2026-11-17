"""Verify standard WearEngine hello/status -> exit -> ping -> new-boot handshake."""
import argparse,datetime,json,pathlib,queue,secrets,sys,time
P=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(P/'relay'))
from relay import application_identity
from manager import Parts
import frida
parser=argparse.ArgumentParser();parser.add_argument('--seconds',type=int,default=600);args=parser.parse_args()
if not 15<=args.seconds<=600:parser.error('seconds must be 15..600')
version=json.loads((P/'watch/entry/src/main/config.json').read_text())['app']['version']['name']
output=P.parents[1]/'artifacts/cloudm-audio-analysis/lifecycle-live-result.json'
record={'version':version,'status':'waiting-ready','events':[],'initialHandshake':False,'exitApplicationAck':False,'notRunningObserved':False,'newRunObserved':False,'reopenedHandshake':False}
q=queue.Queue();parts=Parts();session=None;agent=None
sid=secrets.token_hex(8);command_id=0;pending=None;oldboot=None;phase='initial';nextping=0;attempts=0;exit_time=None

def note(kind,**data):
    event={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':kind,**data}
    record['events'].append(event);output.write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(event),flush=True)

def send(op):
    global command_id,pending
    command_id+=1
    value={'v':1,'t':'command','session':sid,'id':command_id,'op':op,'args':{'version':version} if op=='exit' else {'enabled':False},'ttl':15000}
    reply=agent.exports_sync.command(value)
    pending={'op':op,'id':command_id,'seq':reply['sequence'],'at':time.monotonic(),'transport':False,'ack':False}
    record['status']=op+'-sent';note('command-sent',operation=op,id=command_id,sequence=reply['sequence'])

try:
    device=frida.get_device_manager().add_remote_device('127.0.0.1:27043')
    process=next(p for p in device.enumerate_processes() if p.name=='CrescentRelay')
    session=device.attach(process.pid);agent=session.create_script((P/'build/iphone-agent.js').read_text())
    agent.on('message',lambda m,d:q.put(m));agent.load();agent.exports_sync.configure(application_identity(),False);agent.exports_sync.reserve()
    deadline=time.monotonic()+args.seconds;note('waiting',targetVersion=version)
    while time.monotonic()<deadline:
        now=time.monotonic()
        if (phase=='initial' and pending is None and attempts<3 or phase=='relaunch') and now>=nextping:
            reply=agent.exports_sync.ping(False);attempts+=1;nextping=now+3;note('startup-ping',sequence=reply['sequence'],phase=phase)
        if pending and now-pending['at']>15:
            record['status']='application-ack-timeout';note('command-timeout',operation=pending['op']);break
        if exit_time and now-exit_time>90:
            record['status']='relaunch-timeout';note('relaunch-timeout');break
        try:message=q.get(timeout=.25)
        except queue.Empty:continue
        if message.get('type')=='error':note('adapter-error',detail=message.get('description'));continue
        e=message.get('payload',{})
        if e.get('kind')=='p2p-ack':
            code=e.get('code');seq=e.get('sequence');note('p2p-ack',sequence=seq,code=code)
            if phase=='relaunch' and code==201:record['notRunningObserved']=True
            if pending and seq==pending['seq']:
                if code!=207:
                    record['status']='business-channel-rejected';note('command-rejected',operation=pending['op'],code=code);break
                pending['transport']=True
        if e.get('kind')=='protocol-error':note('protocol-error',detail=e.get('message'))
        if e.get('kind')=='managed-part':
            report=parts.receive(e['payload'])
            if report:
                data=report.get('data',{});boot=report.get('boot')
                if data.get('test')=='CLOUDM-CONTROL' and data.get('version')==version:
                    record['latestRuntime']=data
                    note('runtime',boot=boot,data=data)
                    if report.get('event') in ('ready','state') and pending is None:
                        if phase=='initial':
                            oldboot=boot;record['initialBoot']=boot
                            note('bootstrap-handshake',reportedReady=data.get('ready'));send('hello')
                        elif phase=='relaunch' and boot!=oldboot:
                            record['newRunObserved']=True;record['reopenedBoot']=boot;phase='reopened';send('hello')
                if pending and report.get('event')=='ack' and report.get('session')==sid and report.get('id')==pending['id']:
                    note('application-ack',operation=pending['op'],boot=boot,data=data)
                    expectedboot=record.get('reopenedBoot') if phase=='reopened' else oldboot
                    result=data.get('result',{})
                    if not data.get('ok') or boot!=expectedboot or result.get('version')!=version:
                        record['status']='application-rejected';break
                    pending['ack']=True
        if pending and pending['ack'] and pending['transport']:
            op=pending['op'];pending=None
            if op=='hello':send('status')
            elif op=='status':
                if phase=='initial':record['initialHandshake']=True;send('exit')
                else:
                    record['reopenedHandshake']=True;record['status']='verified';note('cycle-verified');break
            elif op=='exit':
                record['exitApplicationAck']=True;exit_time=time.monotonic();phase='relaunch';nextping=exit_time+8
    else:record['status']='runtime-timeout';note('deadline')
except KeyboardInterrupt:
    record['status']='interrupted';note('interrupted')
except Exception as error:
    record['status']='adapter-failed';note('exception',detail=str(error));raise
finally:
    output.write_text(json.dumps(record,indent=2)+'\n')
    if agent:
        try:agent.exports_sync.release()
        except Exception:pass
    if session:session.detach()
