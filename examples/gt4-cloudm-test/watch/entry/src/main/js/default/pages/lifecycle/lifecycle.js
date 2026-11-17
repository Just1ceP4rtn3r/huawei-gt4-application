import application from '@system.app';
import brightness from '@system.brightness';
import bridge from '../../common/bridge';
import managed from '../../common/managed-link';
import Controller from '../../common/managed-controller';
import log from '../../common/diagnostics';
var version='1.0.18',run=String(Date.now()),view=null,controller=null;
var active=false,ready=false,exiting=false,timer=null,exitTimer=null;
var cycle=0,lastReady=0,lastState=0,stage='created',exitTries=0;
function now(){return Date.now();}
function snapshot(){return {test:'CLOUDM-CONTROL',version:version,run:run,cycle:cycle,phase:stage,ready:ready,screen:'lifecycle'};}
function emit(event,session,id,data){managed.emit(event,session,id,data);}
function status(value){stage=value;if(view)view.status=value;}
function stop(){
 active=false;ready=false;clearInterval(timer);timer=null;clearTimeout(exitTimer);exitTimer=null;
 bridge.stop();managed.stop();if(controller)controller.stop();
 try{brightness.setKeepScreenOn({keepScreenOn:false});}catch(e){}
}
function finishExit(){
 if(!active||!exiting)return;
 if(!managed.idle()&&++exitTries<200){exitTimer=setTimeout(finishExit,100);return;}
 if(!managed.idle()){status('exit-ack-timeout');exiting=false;return;}
 status('terminate-call');stop();
 try{application.terminate();}
 catch(e){status('terminate-exception');if(view)view.detail=String(e);return;}
 // If termination is asynchronous, this timer only runs if the instance survives.
 exitTimer=setTimeout(function(){status('terminate-returned-alive');
  managed.start();managed.emit('state','',0,snapshot());},2000);
}
function execute(op,args,done){
 if(exiting&&op!=='status'&&op!=='pause'){done(null,'Application is exiting');return;}
 if(op==='hello'||op==='status'||op==='pause'){done(snapshot());return;}
 if(op==='logs'){done(JSON.parse(log.snapshot()));return;}
 if(op==='exit'){
  if(args.version!==version){done(null,'Version mismatch');return;}
  exiting=true;status('exiting');managed.quiesce();done({version:version,run:run,exiting:true});
  exitTries=0;exitTimer=setTimeout(finishExit,200);return;
 }
 done(null,'Unsupported control operation');
}
function start(){
 if(active)return;active=true;exiting=false;ready=false;cycle++;status('initializing');
 managed.start(function(s){if(view)view.detail=s;});
 try{brightness.setKeepScreenOn({keepScreenOn:true});}catch(e){}
 bridge.start(function(s){if(view)view.detail=s;},function(m){
  if(m.t==='command')controller.receive(m);
 },function(){ready=true;status('ready');lastReady=now();managed.emit('ready','',0,snapshot());},function(){status('bridge-failed');});
 timer=setInterval(function(){
  if(!active||exiting)return;
  if(ready&&now()-lastReady>12000&&managed.idle()){lastReady=now();managed.emit('ready','',0,snapshot());}
  else if(now()-lastState>5000&&managed.idle()){lastState=now();var s=snapshot();s.nativeLog=JSON.parse(log.snapshot()).events.slice(-4);managed.emit('state',controller.session,0,s);}
 },250);
}
export default {
 data:{status:'Cloudm control 1.0.18',detail:'Initializing'},
 onInit:function(){view=this;controller=new Controller(execute,emit,now);},
 onShow:function(){view=this;if(!controller)controller=new Controller(execute,emit,now);start();},
 onHide:stop,
 onDestroy:stop
};
