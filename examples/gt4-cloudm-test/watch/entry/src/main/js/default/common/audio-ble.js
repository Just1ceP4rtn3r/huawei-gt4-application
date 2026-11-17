// Same RawfileTest detect-route framing, without pointer/transport dependencies.
var native=null,pending=null,part=0,token='',busy=false,sequence=0,active=false;
var boot=('00000000'+(Date.now()>>>0).toString(16)).slice(-8);
function flush(){
 if(!active||busy||!pending)return;
 var text=pending.slice(part*48,(part+1)*48),hex='';
 for(var i=0;i<text.length;i++)hex+=('0'+text.charCodeAt(i).toString(16)).slice(-2);
 var route='local.gt4bridge.crescent.gt4rpc.s'+token+'.p'+(part+1)+'n'+Math.ceil(pending.length/48)+'.x'+hex;
 busy=true;var finished=false;
 var timer=setTimeout(function(){done(false);},2000);
 function done(ok){if(finished)return;finished=true;if(!active||!pending){busy=false;return;}clearTimeout(timer);busy=false;if(ok){part++;if(part*48>=pending.length){pending=null;return;}}else{pending=null;return;}setTimeout(flush,80);}
 try{native.detect({bundleName:route,success:function(){done(true);},fail:function(){done(false);}});}catch(e){done(false);}
}
export default {
 start:function(onMessage,onState){native=requireNative('system.wearengine');active=true;
 function state(s){if(onState)onState(s);}
 function failed(d,c){state('fail '+String(c)+' '+String(d).slice(0,30));}
 try{state('version');native.getWearEngineVersion({sdkVersion:'3',complete:function(d){
 state('package');native.setPackageName({appName:'local.gt4bridge.crescent',complete:function(){
 state('fingerprint');native.setFingerprint({appName:'local.gt4bridge.crescent',appCert:'41AA272C4F19BC53493F79B526855CBEA93B9311A82EEA18E98F5A2163776A28',complete:function(){
 setTimeout(function(){state('subscribe');native.unsubscribeMsg();native.subscribeMsg({success:function(d){
 if(!d||d.isRegister){state('registered');return;}
 var message=typeof d==='string'?d:d.message;
 if(message){try{onMessage(JSON.parse(message));}catch(e){state('message-error');}}
 },fail:failed});},100);},fail:failed});},fail:failed});},fail:failed});}catch(e){state('exception '+String(e).slice(0,40));}
 },
 probe:function(version,done){if(!this.idle())return false;busy=true;var finished=false;
 function finish(s){if(finished)return;finished=true;busy=false;done(s);}
 setTimeout(function(){finish('timeout');},5000);
 try{native.sendMsg({deviceId:'remote',bundleName:'local.gt4bridge.crescent',abilityName:'',message:JSON.stringify({v:1,t:'probe',version:version}),success:function(){finish('success');},fail:function(d,c){finish('fail '+String(c)+' '+String(d).slice(0,30));}});}catch(e){finish('exception '+String(e).slice(0,30));}return true;},
 pollExit:function(version,onExit){if(!this.idle())return false;busy=true;var finished=false;
 var query=('00000000'+((Date.now()+ ++sequence)>>>0).toString(16)).slice(-8);
 var route='local.gt4bridge.crescent.gt4ctl.exit.v'+version.split('.').join('_')+'.b'+boot+'.q'+query;
 var timeout=setTimeout(function(){finish(false);},2000);
 function finish(exit){if(finished)return;finished=true;clearTimeout(timeout);busy=false;if(active&&exit)onExit();}
 try{native.detect({bundleName:route,success:function(){finish(true);},fail:function(){finish(false);}});}catch(e){finish(false);}return true;},
 stop:function(){active=false;pending=null;try{if(native)native.unsubscribeMsg();}catch(e){}},
 idle:function(){return active&&!busy&&!pending;},
 emit:function(event,session,id,data){if(!this.idle())return false;var text=JSON.stringify({v:1,t:'rpc',boot:boot,seq:++sequence,event:event,session:session,id:id,data:data});if(text.length>960)return false;pending=text;part=0;token=('00000000'+((Date.now()+sequence)>>>0).toString(16)).slice(-8);flush();return true;}
};
