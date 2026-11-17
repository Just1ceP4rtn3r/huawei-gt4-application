#!/usr/bin/env python3
"""Own and clean only services started by this invocation. No remote files."""
import os,pathlib,subprocess,socket,time,signal,sys,fcntl,shutil
ROOT=pathlib.Path(__file__).resolve().parents[3];PROJECT=ROOT/'app/GT4AirPointerWiFiInstall'
USB=os.environ.get('GT4_FRIDA_DEVICE_ID')
ALIAS=os.environ.get('GT4_IPHONE_HOST_KEY_ALIAS') or os.environ.get('GT4_IPHONE_HOST')
if not USB or not ALIAS:raise SystemExit('Set GT4_FRIDA_DEVICE_ID and GT4_IPHONE_HOST_KEY_ALIAS in .local/gt4-airpointer-wifi.env')
PORT=os.environ.get('GT4_USB_SSH_PORT','2229')
if not PORT.isdigit() or not 1024<=int(PORT)<=65535:raise SystemExit('Invalid GT4_USB_SSH_PORT')
os.environ.update(GT4_IPHONE_HOST='127.0.0.1',GT4_IPHONE_PORT=PORT,GT4_IPHONE_HOST_KEY_ALIAS=ALIAS,GT4_TRANSPORT='mac-tcp')
(PROJECT/'build').mkdir(parents=True,exist_ok=True)
proxy=server=child=None;owned=set();code=1
lock=open(PROJECT/'build/mac-test.lock','a')
try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError:raise SystemExit('A Mac test is already running; stop it before starting another')
def ssh(command):
    r=subprocess.run(['bash',str(ROOT/'scripts/ssh.sh'),'HISTFILE=/dev/null; export HISTFILE; '+command],capture_output=True,text=True,timeout=12)
    if r.returncode:raise RuntimeError('USB SSH unavailable; connect the paired iPhone by USB')
    return r.stdout
def pids():
    result=set()
    for line in ssh('ps -axo pid,comm').splitlines():
        f=line.strip().split(None,1)
        if len(f)==2 and f[0].isdigit() and pathlib.PurePosixPath(f[1]).name=='frida-server':result.add(int(f[0]))
    return result
def stop(*_):raise KeyboardInterrupt
signal.signal(signal.SIGTERM,stop)
try:
    try:
        with socket.create_connection(('127.0.0.1',int(PORT)),timeout=.5):pass
    except OSError:
        proxy=subprocess.Popen([shutil.which('iproxy') or 'iproxy','-u',USB,'-l',PORT+':22'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        time.sleep(1)
    before=pids()
    if not before:
        server=subprocess.Popen(['bash',str(ROOT/'scripts/ssh.sh'),'HISTFILE=/dev/null; export HISTFILE; exec /var/jb/usr/sbin/frida-server -l 127.0.0.1:27042'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        end=time.monotonic()+8
        while time.monotonic()<end:
            owned=pids()-before
            if owned:break
            time.sleep(.5)
        if len(owned)!=1:raise RuntimeError('Cannot identify this run’s Frida server')
    child=subprocess.Popen([sys.executable,str(PROJECT/'scripts/run-mac-tcp.py'),*sys.argv[1:]],start_new_session=True)
    code=child.wait()
except KeyboardInterrupt:code=130
except Exception as error:print(str(error),file=sys.stderr);code=1
finally:
    signal.signal(signal.SIGINT,signal.SIG_IGN)
    signal.signal(signal.SIGTERM,signal.SIG_IGN)
    if child and child.poll() is None:
        child.terminate()
        try:child.wait(timeout=55)
        except subprocess.TimeoutExpired:child.kill();child.wait()
    try:
        if owned:
            for pid in owned & pids():ssh('kill -TERM '+str(pid))
    except Exception:print('Phone server cleanup could not be confirmed',file=sys.stderr)
    for p in (server,proxy):
        if p and p.poll() is None:
            p.terminate()
            try:p.wait(timeout=3)
            except subprocess.TimeoutExpired:p.kill();p.wait()
sys.exit(code)
