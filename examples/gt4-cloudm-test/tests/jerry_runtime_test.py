"""OFFLINE SDK Jerry runtime smoke: mocked APIs/sensors, never a device result."""
import os
import pathlib
import re
import subprocess

PROJECT = pathlib.Path(__file__).resolve().parents[1]
ROOT = PROJECT.parents[1]
JERRY = ROOT / 'tools/ohos-sdk/9/js/build-tools/ace-loader/bin/jerry'
CONTROL = PROJECT / 'watch/build/loader_out_lite/js/default/pages/control/control.js'
HARNESS = ROOT / '.local/tmp/gt4airpointer-jerry-runtime.js'

PREFIX = r'''
// OFFLINE MOCKS: no BLE, sensors, input injection, or device access.
var view,clock=1730000000000,nextTimer=0,tasks=[],accel=null,gyro=null;
Date.now=function(){return clock;};
function ViewModel(o){view=o;for(var k in o.data)o[k]=o.data[k];return o;}
function setTimeout(f,ms){var id=++nextTimer;tasks.push({id:id,at:clock+(ms||0),f:f,repeat:0});return id;}
function clearTimeout(id){for(var i=tasks.length-1;i>=0;i--)if(tasks[i].id===id)tasks.splice(i,1);}
function setInterval(f,ms){var id=setTimeout(f,ms);tasks[tasks.length-1].repeat=ms||1;return id;}
function clearInterval(id){clearTimeout(id);}
function advance(ms){var end=clock+ms,steps=0;
 while(true){var index=-1,at=end+1;
  for(var i=0;i<tasks.length;i++)if(tasks[i].at<at){index=i;at=tasks[i].at;}
  if(index<0 || at>end)break;
  if(++steps>300)throw Error('OFFLINE timer bound exceeded');
  var t=tasks.splice(index,1)[0];clock=t.at;
  if(t.repeat){t.at+=t.repeat;tasks.push(t);}t.f();
 }clock=end;
}
function _c(tag,options,children){
 if(options && options.attrs && typeof options.attrs.value==='function')options.attrs.value.call(view);
 return null;
}
function _i(condition,yes,no){return condition?(typeof yes==='function'?yes():yes):(typeof no==='function'?no():no);}
function success(o,value){if(o && o.success)setTimeout(function(){o.success(value);},0);}
function complete(o,value){if(o && o.complete)setTimeout(function(){o.complete(value);},0);}
var nativeApi={
 getInfo:function(){return {versionName:'offline-runtime'};},
 getWearEngineVersion:function(o){complete(o,'3.0.402');},
 setPackageName:function(o){complete(o);},
 setFingerprint:function(o){complete(o);},
 subscribeMsg:function(o){success(o,{isRegister:true});},
 unsubscribeMsg:function(){},
 subscribeAccelerometer:function(o){accel=o.success;},
 subscribeGyroscope:function(o){gyro=o.success;},
 unsubscribeAccelerometer:function(){accel=null;},
 unsubscribeGyroscope:function(){gyro=null;},
 setKeepScreenOn:function(o){success(o);},
 detect:function(o){success(o);},
 sendMsg:function(o){if(o && o.fail)setTimeout(function(){o.fail();},0);},
 terminate:function(){}
};
function requireNative(){return nativeApi;}
'''
SUFFIX = r'''
if(!view || !view.onInit || !view.onShow)throw Error('OFFLINE view missing');
view.onInit();view.onShow();advance(300);
if(typeof view.render!=='function')throw Error('OFFLINE render missing');
view.render.call(view);
if(!accel || !gyro)throw Error('OFFLINE sensor callbacks missing');
view.calibrate();
for(var sample=0;sample<40;sample++){
 advance(20);accel({x:0,y:0,z:1});gyro({x:0,y:0,z:0});
}
view.render.call(view);
if(view.calibration!=='Ready')throw Error('OFFLINE calibration failed: '+view.calibration);
// Prove cancellation, including a repeated timer canceled before its next tick.
var canceled=false,id=setTimeout(function(){canceled=true;},1);clearTimeout(id);
id=setInterval(function(){canceled=true;},1);clearInterval(id);advance(2);
if(canceled)throw Error('OFFLINE canceled timer executed');
print('OFFLINE_JERRY_RUNTIME_READY samples=40 virtualStepMs=20');
'''

def main():
    assert CONTROL.is_file(), 'Build the watch first'
    HARNESS.parent.mkdir(parents=True, exist_ok=True)
    HARNESS.write_text(PREFIX + '\n' + CONTROL.read_text() + '\n' + SUFFIX)
    os.chmod(HARNESS, 0o600)
    env = dict(os.environ, TMPDIR=str(ROOT / '.local/tmp'))
    result = subprocess.run([str(JERRY), '--mem-stats', str(HARNESS)],
                            env=env, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=30)
    print(result.stdout, end='')
    assert result.returncode == 0, 'OFFLINE Jerry runtime failed'
    assert 'OFFLINE_JERRY_RUNTIME_READY' in result.stdout, 'Offline assertion did not complete'
    peak = re.search(r'(?:Peak allocated|Peak memory allocated)[^\n]*', result.stdout, re.I)
    if peak: print('OFFLINE memory summary:', peak.group(0))
    print('OFFLINE ONLY: mocked native callbacks and sensor samples; no device validation')

if __name__ == '__main__':
    main()
