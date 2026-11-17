#!/usr/bin/env python3
"""Mac direct TCP. Phone App owns AP renewal; USB obtains session material at startup."""
import os,sys,pathlib,importlib.util,subprocess,json,time,queue,signal
def stop(*_):raise KeyboardInterrupt
signal.signal(signal.SIGTERM,stop)
ROOT=pathlib.Path(__file__).resolve().parents[3];PROJECT=ROOT/'app/GT4AirPointerWiFiInstall'
os.environ['GT4_TRANSPORT']='mac-tcp'
if not os.environ.get('GT4_FRIDA_DEVICE_ID'):raise SystemExit('Run scripts/test-mac.sh with local device configuration')
sys.path.insert(0,str(PROJECT/'relay'))
from manager import attach_phone
import frida
spec=importlib.util.spec_from_file_location('ap',PROJECT/'scripts/test-ap.py');ap=importlib.util.module_from_spec(spec);spec.loader.exec_module(ap)
ap.build()
def record(value):print(json.dumps(value),flush=True)
def manage(*args,timeout=320):
    r=subprocess.run(['bash',str(PROJECT/'scripts/manage.sh'),*args],capture_output=True,text=True,timeout=timeout)
    try:value=json.loads(r.stdout)
    except Exception:value={'error':'No manager result'}
    record({'kind':'manager','command':args[0],'code':r.returncode,'result':value})
    if r.returncode:raise RuntimeError('Manager operation failed')
    return value
subprocess.run(['bash',str(ROOT/'scripts/ssh.sh'),'HISTFILE=/dev/null; export HISTFILE; uiopen --bundleid local.gt4bridge.crescent'],check=True,timeout=12)
device=frida.get_device(os.environ['GT4_FRIDA_DEVICE_ID'],timeout=5)
s=attach_phone(device,queue.Queue(),time.monotonic()+115);s.detach()
started=False
try:
    record({'kind':'waiting-for-phone-owned-hotspot','deadlineSeconds':120})
    end=time.monotonic()+120
    while True:
        address=subprocess.run(['/usr/sbin/ipconfig','getifaddr','en0'],capture_output=True,text=True).stdout.strip()
        route=subprocess.run(['/sbin/route','-n','get','192.168.1.1'],capture_output=True,text=True).stdout
        if address.startswith('192.168.1.') and 'interface: en0' in route and 'destination: default' not in route:break
        if time.monotonic()>end:raise RuntimeError('Mac has not joined the phone-managed watch hotspot')
        time.sleep(1)
    record({'kind':'mac-wifi-ready','interface':'en0','address':address})
    started=True
    startup=manage('start',*(['--enable'] if '--enable' in sys.argv else []))
    version=startup.get('result',{}).get('version','0')
    if tuple(int(v) for v in version.split('.'))<(1,5,3):raise RuntimeError('GT4 AirPointer 1.5.3 or newer is required for arm-before-stream startup')
    manage('command','calibrate')
    record({'kind':'calibrating','instruction':'Hold watch still until Ready','deadlineSeconds':30})
    calibration_end=time.monotonic()+30
    while True:
        reply=manage('command','status')
        state=reply.get('result',{}).get('ack',{}).get('data',{}).get('result',{})
        if state.get('ready') is True and state.get('calibration')=='Ready':break
        if time.monotonic()>=calibration_end:raise RuntimeError('Calibration did not become Ready within 30 seconds; mouse was not armed')
        time.sleep(1)

    if '--enable' in sys.argv:manage('command','arm')
    manage('command','pointer','--args','{"enabled":true,"backend":"experimental-ping"}')
    record({'kind':'mac-direct-running','enabled':'--enable' in sys.argv})
    while True:
        time.sleep(1)
        state_path=PROJECT/'build/managed/state.json'
        try:health=json.loads(state_path.read_text())
        except (OSError,ValueError):continue
        if health.get('phase') in ('error','stopped'):
            raise RuntimeError('Session stopped: '+str(health.get('error') or health.get('phase')))

except KeyboardInterrupt:
    record({'kind':'stopping'})
except Exception as error:
    record({'kind':'test-failed','reason':str(error)})
    sys.exit(1)
finally:
    signal.signal(signal.SIGINT,signal.SIG_IGN)
    signal.signal(signal.SIGTERM,signal.SIG_IGN)
    if started:
        try:manage('stop',timeout=45)
        except Exception:pass
