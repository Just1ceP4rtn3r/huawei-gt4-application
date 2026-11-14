"""Parse actual emitted watch JS with the SDK's Lite JerryScript, beyond Node/V8 checks."""
import pathlib
import subprocess
project=pathlib.Path(__file__).resolve().parents[1]
root=project.parents[1]
jerry=root/'tools/ohos-sdk/9/js/build-tools/ace-loader/bin/jerry'
files=sorted((project/'watch/build/loader_out_lite/js').rglob('*.js'))
assert files,'No compiled watch JS'
for path in files:subprocess.run([str(jerry),'--parse-only',str(path)],check=True)
print('Lite JerryScript parser accepted all '+str(len(files))+' shipped watch scripts')
