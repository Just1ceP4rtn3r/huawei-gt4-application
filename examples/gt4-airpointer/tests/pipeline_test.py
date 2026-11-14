#!/usr/bin/env python3
"""Exercise the compiled desktop binary through the exact NDJSON pipe (no mouse events)."""
import json
import pathlib
import subprocess
project=pathlib.Path(__file__).resolve().parents[1]
base={'v':1,'t':'pointer','session':'123-1','sent':1000,'seq':1,'armed':True,'dx':12,'dy':-3,'scroll':0,'buttons':[{'id':1,'kind':'drag','age':0}]}
frames=[base,base,{**base,'seq':2,'sent':1050,'buttons':base['buttons']},{**base,'seq':3,'sent':1100,'armed':False,'buttons':[]}]
wire='\n'.join(json.dumps(f) for f in frames)+'\n'
result=subprocess.run([str(project/'build/GT4AirPointerSink'),'--dry-run'],input=wire,text=True,capture_output=True,timeout=5,check=True)
out=[json.loads(x) for x in result.stdout.splitlines()]
assert len(out)==3,out
assert out[0]['dragging'] is True
assert out[1]['buttons']==[],out
assert out[2]['armed'] is False and out[2]['dragging'] is False
assert all(x['enabled'] is False for x in out)
print('NDJSON pipeline passed: real executable, replay suppression, drag toggle and pause release; no OS input injected')
# Exercise the actual watchdog timer while stdin remains open.
import time
child=subprocess.Popen([str(project/'build/GT4AirPointerSink'),'--dry-run'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
child.stdin.write(json.dumps(base)+'\n');child.stdin.flush()
assert json.loads(child.stdout.readline())['dragging'] is True
time.sleep(0.7)
child.stdin.close();child.stdin=None
stdout,stderr=child.communicate(timeout=3)
assert child.returncode==0,(stdout,stderr)
assert 'Input timeout: paused, drag released' in stderr,stderr
print('Live watchdog timer passed with stdin open; no OS input injected')
