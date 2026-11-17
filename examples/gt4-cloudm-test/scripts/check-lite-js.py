"""Reject JerryScript diagnostic output as well as nonzero exit codes."""
from pathlib import Path
import subprocess
p=Path(__file__).resolve().parents[1];root=p.parents[1]
files=sorted((p/'watch/build/loader_out_lite/js').rglob('*.js'))
assert files,'No emitted JS'
for path in files:
 r=subprocess.run([str(root/'tools/ohos-sdk/9/js/build-tools/ace-loader/bin/jerry'),'--parse-only',str(path)],capture_output=True,text=True)
 assert r.returncode==0 and not (r.stdout+r.stderr).strip(), 'Lite parse failed: '+str(path)+' '+r.stdout+r.stderr
print('SDK Lite JerryScript parsed '+str(len(files))+' scripts without diagnostics (offline only)')
