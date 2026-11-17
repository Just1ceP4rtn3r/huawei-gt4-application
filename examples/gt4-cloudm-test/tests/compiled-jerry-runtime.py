"""Execute shipped JS in SDK Jerry with offline native substitutes."""
from pathlib import Path
import subprocess
p=Path(__file__).resolve().parents[1];root=p.parents[1]
prefix=r'''
var view,clock=100000,next=0,tasks=[],store={},binaryStore={},plays=0,routes=0;
Date.now=function(){return clock;};
function ViewModel(o){view=o;for(var k in o.data)o[k]=o.data[k];return o;}
function setTimeout(f,ms){var id=++next;tasks.push({id:id,at:clock+(ms||0),f:f,repeat:0});return id;}
function setInterval(f,ms){var id=setTimeout(f,ms);tasks[tasks.length-1].repeat=ms;return id;}
function clearTimeout(id){for(var i=tasks.length-1;i>=0;i--)if(tasks[i].id===id)tasks.splice(i,1);}
var clearInterval=clearTimeout;
function advance(ms){var end=clock+ms,count=0;while(true){var ix=-1,at=end+1;for(var i=0;i<tasks.length;i++)if(tasks[i].at<at){ix=i;at=tasks[i].at;}if(ix<0||at>end)break;if(++count>3000)throw Error('timer bound');var t=tasks.splice(ix,1)[0];clock=t.at;if(t.repeat){t.at+=t.repeat;tasks.push(t);}t.f();}clock=end;}
function ok(o,d){if(o.success)setTimeout(function(){o.success(d);},0);}
var api={mkdir:function(o){ok(o);},writeText:function(o){store[o.uri]=o.text;ok(o);},readText:function(o){ok(o,{text:store[o.uri]});},writeArrayBuffer:function(o){var unit=o.uri.indexOf('music/')>=0?3761:1144;if(!o.append)binaryStore[o.uri]={unit:new Uint8Array(unit),size:0};var v=binaryStore[o.uri];for(var i=0;i<o.buffer.length;i++){var pos=v.size+i;if(pos<unit)v.unit[pos]=o.buffer[i];else if(v.unit[pos%unit]!==o.buffer[i])throw Error('repeated frame mismatch');}v.size+=o.buffer.length;ok(o);},readArrayBuffer:function(o){var v=binaryStore[o.uri],b=new Uint8Array(o.length);if(o.position+o.length>v.size)throw Error('read beyond end');for(var i=0;i<o.length;i++)b[i]=v.unit[(o.position+i)%v.unit.length];ok(o,{buffer:b});},setKeepScreenOn:function(){},getWearEngineVersion:function(o){setTimeout(function(){o.complete('3.0.402');},0);},setPackageName:function(o){setTimeout(o.complete,0);},setFingerprint:function(o){setTimeout(o.complete,0);},unsubscribeMsg:function(){},subscribeMsg:function(o){ok(o,{isRegister:true});},detect:function(o){routes++;ok(o);},play:function(){plays++;if(this.onplay)this.onplay();},stop:function(){},getPlayState:function(o){ok(o,{state:'play',src:this.src,currentTime:(clock-100000)/1000});}};
function requireNative(){return api;}
'''
suffix=r'''
view.onShow();advance(60000);advance(60000);
if(plays!==1)throw Error('play calls '+plays);
if(binaryStore['internal://app/music/10020.tmp'].size!==120352)throw Error('long tone file truncated');
if(!store['internal://app/cur_playlist'])throw Error('playlist missing');
if(store['internal://app/diag_playlist_120'].indexOf(',1,0,')<0)throw Error('plain MP3 must not enable vendor transform');
if(routes<5)throw Error('no BLE export');
var result=JSON.parse(store['internal://app/audio-result-1.0.20.json']);
if(result.phase!=='test-complete'||result.files.length!==2||result.failure)throw Error(JSON.stringify(result));
print('OFFLINE SDK JERRY PASS: shipped script initialized, files verified, playlist prepared, one delayed play attempt, BLE exported, timed stop reached. Not a device test.');
'''
f=root/'.local/tmp/cloudm-compiled-jerry.js';f.write_text(prefix+(p/'watch/build/loader_out_lite/js/default/pages/audio/audio.js').read_text()+suffix)
r=subprocess.run([str(root/'tools/ohos-sdk/9/js/build-tools/ace-loader/bin/jerry'),str(f)],capture_output=True,text=True)
print(r.stdout+r.stderr,end='');assert r.returncode==0 and 'OFFLINE SDK JERRY PASS' in r.stdout and 'Script Error' not in r.stdout+r.stderr
