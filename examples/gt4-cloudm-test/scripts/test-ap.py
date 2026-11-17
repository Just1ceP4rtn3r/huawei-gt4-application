#!/usr/bin/env python3
"""Bounded AP open/close through existing authenticated BLE; no OTA writes.
Phone adapter lives in memory. Credentials stay in memory and never enter reports.
"""
import os,datetime,importlib.util,json,pathlib,queue,re,subprocess,time
import frida
ROOT=pathlib.Path(__file__).resolve().parents[3]
PROJECT=ROOT/'app/GT4AirPointerWiFiInstall'
spec=importlib.util.spec_from_file_location('install_channel',PROJECT/'scripts/install-channel.py');channel=importlib.util.module_from_spec(spec);spec.loader.exec_module(channel)
tlv,parse=channel.tlv,channel.parse
PKG=b'hw.uniedevice.wifiTransfer'
def body(action):
    if action not in (3,5):raise ValueError('AP actions only')
    row=tlv(5,bytes.fromhex('35a66fb3'))+tlv(6,bytes([action]))
    if action==3:row+=tlv(7,json.dumps({'EncryptedType':0,'countrycode':'','authtype':2},separators=(',',':')).encode())
    return tlv(1,PKG)+tlv(2,PKG)+tlv(0x83,tlv(0x84,row))
def build():
    source=(ROOT/'scripts/phone-bridge.js').read_text().replace("'../tools/","'"+str(ROOT)+"/tools/")
    source=source.replace('if(![40,42].includes(sid))return;', 'if(sid!==55)return;')
    old="if(!(sid===42&&[3,6].includes(cid))&&!(sid===40&&[2,3,4,6,7].includes(cid)))throw Error('Endpoint not allowed');"
    allowed=[list(body(3)),list(body(5))]
    new="if(sid!==55||cid!==1||plaintext||!"+json.dumps([json.dumps(v,separators=(',',':')) for v in allowed])+".includes(JSON.stringify(body)))throw Error('Only exact AP open/close allowed');"
    assert old in source;source=source.replace(old,new)
    source=source.replace('rpc.exports={', 'rpc.exports={sessionkey(){return onMain(()=>{if(!reserved)throw Error(\"Reserve required\");return Array.from(key());});},')
    entry=ROOT/'.local/tmp/gt4-wifi-example-ap-agent.js';entry.write_text(source)
    subprocess.run([str(ROOT/'tools/frida-agent/node_modules/.bin/esbuild'),str(entry),'--bundle','--format=iife','--outfile='+str(PROJECT/'build/ap-agent.js')],check=True)
class APChannel(channel.Channel):
    def __enter__(self):
        device=frida.get_device(os.environ['GT4_FRIDA_DEVICE_ID'],timeout=5) if os.environ.get('GT4_FRIDA_DEVICE_ID') else frida.get_device_manager().add_remote_device('127.0.0.1:27043')
        process=next(p for p in device.enumerate_processes() if p.name=='CrescentRelay')
        self.session=device.attach(process.pid)
        self.agent=self.session.create_script((PROJECT/'build/ap-agent.js').read_text())
        def message(m,d):
            if m.get('type')=='error':self.events.put({'kind':'error','message':'AP adapter error'})
            else:self.events.put(m.get('payload',{}))
        self.agent.on('message',message);self.agent.load();self.info=self.agent.exports_sync.info();self.agent.exports_sync.reserve();self.reserved=True;return self

def sanitized(value,key=''):
    if re.search('password|passwd|secret|key|ssid|mac|token',key,re.I):return '[redacted]'
    if isinstance(value,dict):return {k:sanitized(v,k) for k,v in value.items()}
    if isinstance(value,list):return [sanitized(v,key) for v in value[:16]]
    if value is None or isinstance(value,(int,float,bool)):return value
    if isinstance(value,str) and (re.fullmatch(r'\d{1,3}(\.\d{1,3}){3}',value) or value.isdigit()):return value
    return '[string]'
def decode(event):
    result={'sid':event['sid'],'cid':event['cid'],'rows':[]};credentials=[]
    fields=dict(parse(bytes(event['body'])))
    if 127 in fields:result['status']=int.from_bytes(fields[127],'big')
    for tag,outer in parse(fields.get(0x83,b'')):
        if tag!=0x84:continue
        f=dict(parse(outer));row={'configType':int.from_bytes(f.get(5,b''),'big'),'action':int.from_bytes(f.get(6,b''),'big')}
        if 7 in f:
            try:
                obj=json.loads(f[7]);row['data']=sanitized(obj)
                if isinstance(obj,dict):credentials.append(obj)
            except Exception:row['dataBytes']=len(f[7])
        result['rows'].append(row)
    return result,credentials

def main():
    build();report={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'realDevice':True,'open':[],'close':[]};target=ROOT/'artifacts/gt4-network-runtime/ap-test.json'
    def save():target.write_text(json.dumps(report,indent=2)+'\n')
    with APChannel() as c:
        opened=False
        try:
            opened=True;c.write(55,1,body(3));report['openWrite']=True;save()
            end=time.monotonic()+20
            while time.monotonic()<end:
                try:e=c.event(min(1,end-time.monotonic()))
                except TimeoutError:continue
                if e.get('kind')!='packet':continue
                data,raw=decode(e);report['open'].append(data);save();print(json.dumps(data),flush=True)
                for obj in raw:
                    ssid=obj.get('ssid') or obj.get('SSID')
                    if isinstance(ssid,str) and ssid:
                        r=subprocess.run([str(ROOT/'.local/tmp/gt4-ap-scan')],input=ssid+'\n',capture_output=True,text=True,timeout=15)
                        try:report['scan']=json.loads(r.stdout)
                        except Exception:report['scan']={'error':'No structured scanner result'}
                        save()
                if any(r.get('action')==4 for r in data['rows']):break
        finally:
            if opened:
                c.write(55,1,body(5));report['closeWrite']=True;save()
                end=time.monotonic()+8
                while time.monotonic()<end:
                    try:e=c.event(min(1,end-time.monotonic()))
                    except TimeoutError:continue
                    if e.get('kind')=='packet':
                        data,_=decode(e);report['close'].append(data);save()
    report['adapterReleased']=True;save();print(json.dumps(report),flush=True)
if __name__=='__main__':main()
