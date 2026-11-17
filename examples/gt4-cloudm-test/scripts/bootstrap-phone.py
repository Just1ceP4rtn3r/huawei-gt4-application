import pathlib,sys,queue,time
P=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(P/'relay'))
import frida
from manager import bootstrap_phone
q=queue.Queue();d=frida.get_device_manager().add_remote_device('127.0.0.1:27043');p=next(p for p in d.enumerate_processes() if p.name=='CrescentRelay');s=d.attach(p.pid)
try:print(bootstrap_phone(s,q,deadline=time.monotonic()+45))
finally:s.detach()
