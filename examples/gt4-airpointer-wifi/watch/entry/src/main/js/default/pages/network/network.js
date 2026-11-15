import application from '@system.app';
import brightness from '@system.brightness';
import router from '@system.router';
import config from '../../common/config';
import bridge from '../../common/network-bridge';
import managed from '../../common/managed-link';
import Controller from '../../common/managed-controller';
import {probe,cancel} from '../../common/network-probe';
var active=false,controller=null,view=null,cycle=0,timer=null,version='unknown',lastReady=0,wear=null,probeTimer=null,keepScreen=false,lifetimeTimer=null;
function brief(){return {version:version,screen:'network',cycle:cycle,keepScreen:keepScreen};}
function emit(event,session,id,data){managed.emit(event,session,id,data);}
function stop(){if(!active)return;active=false;cycle++;clearTimeout(lifetimeTimer);lifetimeTimer=null;try{brightness.setKeepScreenOn({keepScreenOn:false});}catch(e){}keepScreen=false;clearInterval(timer);clearTimeout(probeTimer);timer=null;cancel();bridge.stop();managed.stop();if(controller)controller.stop();}
function execute(op,args,done){
    if(op==='hello' || op==='status' || op==='pause'){done(brief());return;}
    if(op==='probe' && args.api==='mouse-page'){
        done({opening:'control'});var tries=0;
        function back(){if(!active)return;if(!managed.idle() && ++tries<100){setTimeout(back,100);return;}router.replace({uri:'pages/control/control'});}setTimeout(back,100);return;
    }
    if(op==='probe'){
        managed.emit('probe',controller.session,controller.lastID,{api:args.api,action:args.action,stage:'before-native-probe'});
        var waits=0;
        function invoke(){if(!active)return;if(!managed.idle() && ++waits<80){probeTimer=setTimeout(invoke,100);return;}
            probe(args,function(result){if(active){view.result=result.name+' '+result.action+' '+(result.ok?'OK':result.error || 'failed');done(result);}});
        }probeTimer=setTimeout(invoke,100);return;
    }
    if(op==='exit'){done({exiting:true});var attempts=0;
        function exit(){if(!active)return;if(!managed.idle() && ++attempts<80){setTimeout(exit,100);return;}stop();application.terminate();}setTimeout(exit,200);return;}
    done(null,'Network probe page only');
}
export default {
    data:{link:'Starting BLE management',result:'Awaiting remote probe'},
    onInit:function(){view=this;controller=new Controller(execute,emit,Date.now);try{version=application.getInfo().versionName || 'unknown';}catch(e){}},
    onShow:function(){if(active)return;active=true;view=this;cycle++;managed.start();
        try{brightness.setKeepScreenOn({keepScreenOn:true,success:function(){if(active)keepScreen=true;else brightness.setKeepScreenOn({keepScreenOn:false});}});}catch(e){}
        lifetimeTimer=setTimeout(function(){stop();application.terminate();},180000);
        bridge.start(function(text){if(active)view.link=text;},function(message){if(active && message.t==='command')controller.receive(message);},function(){if(active){lastReady=Date.now();managed.emit('ready','',0,brief());}},function(){});
        timer=setInterval(function(){if(active && Date.now()-lastReady>12000 && managed.idle()){lastReady=Date.now();managed.emit('ready','',0,brief());}},1000);
    },
    onHide:stop,onDestroy:stop
};
