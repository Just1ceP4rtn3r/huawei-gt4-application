"""Read session material once, then detach. Local Node owns the TCP data plane."""
import importlib.util,json,pathlib,queue,subprocess,threading,time
PROJECT=pathlib.Path(__file__).resolve().parents[1]
def run(commands,replies,events,session):
    spec=importlib.util.spec_from_file_location('ap_control',PROJECT/'scripts/test-ap.py')
    ap=importlib.util.module_from_spec(spec);spec.loader.exec_module(ap)
    source=(PROJECT/'build/ap-agent.js').read_text()
    agent=session.create_script(source);agent.load();agent.exports_sync.reserve()
    proc=None
    try:
        proc=subprocess.Popen(['node',str(PROJECT/'relay/mac-tcp.mjs')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1)
        responses=queue.Queue();counter=0
        def read():
            for line in proc.stdout:
                try:
                    value=json.loads(line)
                    if 'event' in value:events.put({'type':'send','payload':value['event']})
                    else:responses.put(value)
                except Exception:pass
        threading.Thread(target=read,daemon=True).start()
        def call(method,args=()):
            nonlocal counter
            counter+=1
            proc.stdin.write(json.dumps({'id':counter,'method':method,'args':args})+'\n');proc.stdin.flush()
            value=responses.get(timeout=12)
            if value.get('id')!=counter:raise RuntimeError('Local TCP reply mismatch')
            if not value.get('ok'):raise RuntimeError('Local TCP failure: '+str(value.get('code'))+' port='+str(value.get('port')))
            return value.get('result')
        material=agent.exports_sync.sessionkey()
        call('init',[material]);material[:]=[0]*len(material);del material
        agent.exports_sync.release()
        agent.unload();agent=None
        session.detach()
        replies.put((0,True,{'attached':True,'dataOwner':'mac'}))
        renewal=time.monotonic();connected=False
        while True:
            try:serial,method,args=commands.get(timeout=.25)
            except queue.Empty:continue
            if method=='quit':break
            try:
                result=call(method,args)
                if method=='transport':connected=True;renewal=time.monotonic()
                if method=='release':connected=False
                replies.put((serial,True,result))
            except Exception as error:replies.put((serial,False,str(error)))
    finally:
        if proc:
            proc.stdin.close()
            try:proc.wait(timeout=3)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
        if agent:
            try:agent.exports_sync.release()
            finally:agent.unload()
