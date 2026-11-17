"""OFFLINE complete management + socket-absent probe in SDK Jerry heap; mocked APIs."""
import pathlib,runpy,subprocess,os
root=pathlib.Path(__file__).resolve().parents[3];m=runpy.run_path(str(root/'app/GT4AirPointerWiFiInstall/tests/jerry_runtime_test.py'))
prefix=m['PREFIX']+'''\nfunction success(o,value){if(o && o.success)setTimeout(function(){o.success(value);},650);}
var keepRequested=false;nativeApi.setKeepScreenOn=function(o){keepRequested=o.keepScreenOn;success(o);};
var receiver=null;nativeApi.subscribeMsg=function(o){receiver=o.success;success(o,{isRegister:true});};
function requireNative(name){if(name==='ohos.net.socket')return undefined;return nativeApi;}
'''
suffix='''
view.onInit();view.onShow();advance(5000);if(!keepRequested)throw Error('Probe must keep screen on');
function command(id,op,args){receiver({message:JSON.stringify({v:1,t:'command',session:'1234567890abcdef',id:id,op:op,args:args,ttl:15000})});}
command(1,'hello',{enabled:false});advance(5000);
command(2,'status',{});advance(5000);
command(3,'probe',{api:'socket',action:'inspect'});advance(10000);
view.render.call(view);print(view.result);view.onHide();if(keepRequested)throw Error('Probe must release screen on exit');print('OFFLINE_NETWORK_FLOW_OK');
'''
p=root/'.local/tmp/wifi-example-network-full-flow.js';p.write_text(prefix+'\n'+(root/'app/GT4AirPointerWiFiInstall/watch/build/loader_out_lite/js/default/pages/network/network.js').read_text()+'\n'+suffix)
r=subprocess.run([str(m['JERRY']),'--mem-stats',str(p)],capture_output=True,text=True,env=dict(os.environ,TMPDIR=str(root/'.local/tmp')));print(r.stdout+r.stderr);assert r.returncode==0
