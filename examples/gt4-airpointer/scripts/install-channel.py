#!/usr/bin/env python3
"""Query the paired GT4 installer over a memory-only iPhone adapter."""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import queue
import time
import frida

PROJECT = pathlib.Path(__file__).resolve().parents[1]
ROOT = PROJECT.parents[1]

def tlv(tag, value):
    size = len(value)
    length = [size & 127]
    size >>= 7
    while size:
        length.insert(0, (size & 127) | 128)
        size >>= 7
    return bytes([tag] + length) + bytes(value)

def parse(data):
    result = []
    i = 0
    while i < len(data):
        tag = data[i]
        i += 1
        if i == len(data) and tag == 0:
            break
        size = 0
        while True:
            b = data[i]
            i += 1
            size = size * 128 + (b & 127)
            if b < 128:
                break
        if i + size > len(data):
            raise ValueError('Truncated TLV')
        result.append((tag, bytes(data[i:i+size])))
        i += size
    return result

def groups(data):
    outer = dict(parse(data)).get(0x81, b'')
    return [dict(parse(value)) for tag,value in parse(outer) if tag == 0x82]

class Channel:
    def __init__(self):
        self.events = queue.Queue()
        self.session = None
        self.agent = None
        self.reserved = False
        self.errors = []
    def __enter__(self):
        device = frida.get_device_manager().add_remote_device('127.0.0.1:27043')
        process = next(p for p in device.enumerate_processes() if p.name == 'CrescentRelay')
        print('Attaching to the existing iPhone process', process.pid, flush=True)
        self.session = device.attach(process.pid)
        print('Loading the memory-only Bluetooth adapter', flush=True)
        self.agent = self.session.create_script((PROJECT/'build/install-agent.js').read_text())
        def message(m,d):
            if m.get('type') == 'error':
                self.errors.append(m.get('description',str(m)))
                self.events.put({'kind':'error','message':self.errors[-1]})
            else:
                self.events.put(m.get('payload',{}))
        self.agent.on('message', message)
        self.agent.load()
        self.info = self.agent.exports_sync.info()
        self.agent.exports_sync.reserve()
        self.reserved = True
        return self
    def write(self,sid,cid,body=b'',plaintext=False):
        return self.agent.exports_sync.write(sid,cid,list(body),plaintext)
    def event(self,timeout=15):
        try:
            event = self.events.get(timeout=timeout)
        except queue.Empty as e:
            raise TimeoutError('No matching watch response before the transfer deadline') from e
        if event.get('kind') in ('error','protocol-error'):
            raise RuntimeError(event.get('message'))
        return event
    def request(self,cid):
        self.write(42,cid,tlv(0x81,b''))
        deadline = time.monotonic()+15
        while time.monotonic()<deadline:
            event=self.event(max(0.01,deadline-time.monotonic()))
            if event.get('sid')==42 and event.get('cid')==cid:
                body=bytes(event['body'])
                fields=dict(parse(body))
                if 0x7F in fields and int.from_bytes(fields[0x7F],'big')!=100000:
                    raise RuntimeError('Installer rejected request: '+str(int.from_bytes(fields[0x7F],'big')))
                return body
        raise TimeoutError('No matching installer reply')
    def __exit__(self,*args):
        try:
            if self.reserved:
                self.agent.exports_sync.release()
        finally:
            if self.session:
                self.session.detach()

def inspect():
    with Channel() as channel:
        report={'connection':channel.info}
        params=groups(channel.request(6))
        if not params:
            raise RuntimeError('Installer returned no platform parameters')
        report['parameters']=[{
            'deviceType':int.from_bytes(p.get(3,b''),'big'),
            'apiLevel':int.from_bytes(p.get(4,b''),'big'),
            'osVersion':p.get(5,b'').decode(errors='replace'),
            'width':int.from_bytes(p.get(7,b''),'big'),
            'height':int.from_bytes(p.get(8,b''),'big')
        } for p in params]
        apps=groups(channel.request(3))
        report['installedApps']=[{
            'bundleName':p.get(3,b'').decode(errors='replace'),
            'version':p.get(4,b'').decode(errors='replace'),
            'name':p.get(6,b'').decode(errors='replace')
        } for p in apps]
        path=PROJECT/'build/watch-installer-inspection.json'
        path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(report,ensure_ascii=False,indent=2))

def save_authentication_identity():
    with Channel() as channel:
        identity=channel.agent.exports_sync.authentication_identity()
        path=ROOT/'.local/signing/authentication-identity.txt'
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(identity+'\n')
        path.chmod(0o600)
        print('Saved authentication identity locally; this is NOT the GT4 debugging UDID')

def install(path,upgrade_from=None):
    checker_path=ROOT/'tools/huawei-watch-sideload-ios/tools/check-watch-bin.py'
    spec=importlib.util.spec_from_file_location('watch_bin_check',checker_path)
    checker=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checker)
    package,errors,notes=checker.check(path)
    if errors:
        raise ValueError('Package preflight failed: '+'; '.join(errors))
    data=path.read_bytes()
    approved_profile=(ROOT/'.local/signing/profiles/com.example.gt4counter.p7b').read_bytes()
    if approved_profile not in data:
        raise ValueError('Package does not embed the currently approved debugging Profile; rebuild it')
    _,files,_=checker.entries(data)
    config=json.loads(files['config.json'])
    if package != json.loads((PROJECT/'watch/entry/src/main/config.json').read_text())['app']['bundleName']:
        raise ValueError('Only this workspace application can be installed')
    report={'bundleName':package,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'events':[],'success':False}
    file_id=None
    unit=None
    bitmap_enabled=False
    plaintext=False
    finished=False
    installed=False
    total_sent=0
    windows=0
    def number(fields,tag,default=None):
        value=fields.get(tag)
        if value is None:
            if default is not None:return default
            raise ValueError('Missing required field '+hex(tag))
        if not 1<=len(value)<=4:raise ValueError('Invalid numeric field')
        return int.from_bytes(value,'big')
    def record(kind,**values):
        item={'kind':kind,**values}
        report['events'].append(item)
        print(json.dumps(item,ensure_ascii=False),flush=True)
    try:
        with Channel() as channel:
            current=groups(channel.request(3))
            previous=next((p for p in current if p.get(3,b'').decode(errors='replace')==package),None)
            if previous is not None:
                previous_version=previous.get(4,b'').decode(errors='replace')
                if not upgrade_from or previous_version!=upgrade_from:
                    raise RuntimeError('Installed version '+previous_version+' does not match explicit upgrade source '+str(upgrade_from))
                def version_key(value):
                    parts=value.split('.')
                    if len(parts)!=3 or not all(x.isdigit() for x in parts):raise ValueError('Unsupported version format')
                    return tuple(int(x) for x in parts)
                target_version=config['app']['version']['name']
                if version_key(target_version)<=version_key(previous_version):raise ValueError('Upgrade must increase version')
                record('upgrade-reviewed',fromVersion=previous_version,toVersion=target_version)
            elif upgrade_from:
                raise RuntimeError('Expected existing demo package is missing; refusing an unreviewed upgrade')
            offer=tlv(1,(package+'_INSTALL').encode())+tlv(2,len(data).to_bytes(4,'big'))+tlv(3,b'\x06')
            channel.write(40,2,offer)
            record('offered',bytes=len(data))
            deadline=time.monotonic()+min(600,max(180,len(data)/512))
            while time.monotonic()<deadline:
                event=channel.event(timeout=min(30,max(.01,deadline-time.monotonic())))
                if event.get('kind')!='packet':continue
                sid,cid=event['sid'],event['cid']
                f=dict(parse(bytes(event['body'])))
                if sid==42 and cid==2:
                    status=number(f,1)
                    identity=f.get(2,b'').decode(errors='replace')
                    if identity and identity!=package:continue
                    details={hex(tag):value.hex() for tag,value in f.items() if tag not in (1,2)}
                    record('install-status',status=status,details=details)
                    if status==103:raise RuntimeError('Watch installer rejected the signed package (103)')
                    if status==102:
                        installed=True
                        if finished:break
                    continue
                if sid!=40:continue
                if 0x7F in f and number(f,0x7F)!=100000:
                    raise RuntimeError('File protocol rejected command '+str(cid)+': '+str(number(f,0x7F)))
                if cid==2:
                    candidate=number(f,4)
                    if not 0<=candidate<=255:raise ValueError('Invalid file ID')
                    if 1 in f and f[1]!=(package+'_INSTALL').encode():raise ValueError('Offer identity mismatch')
                    if 2 in f and number(f,2)!=len(data):raise ValueError('Offer size mismatch')
                    if 3 in f and number(f,3)!=6:raise ValueError('Offer type mismatch')
                    file_id=candidate
                    record('file-id',value=file_id)
                    continue
                if cid in (3,4,5,7,8,9):
                    if file_id is None or number(f,1)!=file_id:continue
                if cid==3:
                    if number(f,2)!=3:raise ValueError('Unsupported checksum mode')
                    offset=number(f,4,0)
                    if offset>len(data):raise ValueError('Invalid hash resume offset')
                    offset=offset if offset<len(data) else 0
                    digest=hashlib.sha256(data[offset:]).digest()
                    channel.write(40,3,tlv(1,bytes([file_id]))+tlv(3,digest)+tlv(4,offset.to_bytes(4,'big')))
                    record('checksum',resumeOffset=offset)
                elif cid==4:
                    unit=number(f,5)
                    maximum=number(f,6)
                    bitmap_enabled=number(f,4,0)==1
                    plaintext=number(f,9,0)==1
                    if not 1<=unit<=47994 or not 1<=maximum<=2*1024*1024:raise ValueError('Invalid transfer limits')
                    if number(f,10,0)!=0:raise ValueError('Subframe checksum mode is not supported by this adapter')
                    answer=tlv(127,(100000).to_bytes(4,'big'))+tlv(1,bytes([file_id]))
                    if plaintext:answer+=tlv(9,b'\x01')
                    channel.write(40,4,answer)
                    record('negotiated',unit=unit,maxRequest=maximum,plaintext=plaintext,bitmap=bitmap_enabled)
                elif cid==5:
                    if unit is None:raise ValueError('Data request before negotiation')
                    offset=number(f,2)
                    count=number(f,3)
                    if count<1 or offset>=len(data) or offset+count>len(data) or count>maximum:raise ValueError('Invalid data range')
                    pieces=(count+unit-1)//unit
                    if pieces>256:raise ValueError('Too many chunks')
                    bitmap=f.get(4,b'')
                    if bitmap and (not bitmap_enabled or len(bitmap)<(pieces+7)//8):raise ValueError('Invalid bitmap')
                    if f.get(5,b''):raise ValueError('Unsupported subframe checksum result')
                    selected=[i for i in range(pieces) if not bitmap or not bitmap[i//8]&(1<<(i%8))]
                    # Existing iOS17 sender treats an all-FF selection as unrestricted.
                    if bitmap and not selected and all(b==255 for b in bitmap[:(pieces+7)//8]):selected=list(range(pieces))
                    windows+=1
                    if windows>128 or total_sent>len(data)*8+65536:raise ValueError('Transfer retry budget exceeded')
                    for index in selected:
                        start=offset+index*unit
                        block=data[start:min(start+unit,offset+count)]
                        raw=bytes([file_id,index])+start.to_bytes(4,'big')+block
                        channel.write(40,6,raw,plaintext)
                        total_sent+=len(block)
                    record('data-window',offset=offset,length=count,sentBytes=total_sent)
                elif cid==7:
                    # Result-only acknowledgements must not trigger an ACK loop.
                    if 2 not in f:continue
                    validity=number(f,2)
                    channel.write(40,7,tlv(127,(100000).to_bytes(4,'big'))+tlv(1,bytes([file_id])))
                    record('file-validity',value=validity)
                    if validity!=1:raise RuntimeError('Watch rejected file integrity: '+str(validity))
                    finished=True
                    if installed:break
                elif cid in (8,9):
                    raise RuntimeError('Watch interrupted file transfer: '+str(cid))
            if not finished or not installed:raise TimeoutError('File transfer or installation not confirmed')
            after=groups(channel.request(3))
            match=next((p for p in after if p.get(3,b'').decode(errors='replace')==package),None)
            if not match:raise RuntimeError('Installer reported success but package is missing from readback')
            report['readback']={'bundleName':package,'version':match.get(4,b'').decode(errors='replace'),'name':match.get(6,b'').decode(errors='replace')}
            if report['readback']['version']!=config['app']['version']['name']:
                raise RuntimeError('Readback version differs from the signed upgrade')
            report['success']=True
            record('installed-and-readback-confirmed',**report['readback'])
    except Exception as e:
        report['error']=str(e)
        raise
    finally:
        (PROJECT/'build/install-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--install',type=pathlib.Path)
    parser.add_argument('--auth-identity',action='store_true')
    parser.add_argument('--upgrade-from',help='Explicit installed version allowed for upgrade; no uninstall')
    args=parser.parse_args()
    if args.auth_identity:save_authentication_identity()
    elif args.install:install(args.install.resolve(),args.upgrade_from)
    else:inspect()
