// Thin W401+ adapter using the exact native fields from Huawei Lite SDK 5.0.2.306.
// Own configuration order explicitly: package once, fingerprint once, then receiver.
import native from './native-wearengine';
import Transport from './transport';
import config from './config';
import log from './diagnostics';
import {resetDiagnostics,cancelExport,exportDiagnostics} from './native-wearengine';
var sender=null,epoch=0,timers=[],registered=false,version=0;
function noop(){}
function format(value){try{return typeof value==='string'?value:JSON.stringify(value);}catch(e){return String(value);}}
export default {
    start:function(report,receive,onReady,onFailure){
        this.stop();resetDiagnostics();var generation=epoch,detecting=false;
        function alive(){return generation===epoch;}
        function prefix(){return 'Native W'+version+' ';}
        function schedule(fn,ms){var t=setTimeout(function(){if(alive())fn();},ms);timers.push(t);}
        function failure(stage,data,code){if(alive())report(prefix()+stage+' failed '+format(data)+' '+String(code));}
        function openSender(){
            if(!alive() || sender)return;
            var adapter={sendMsg:function(options){native.sendMsg({deviceId:'remote',bundleName:config.peerPackage,abilityName:'',message:options.message,
                success:options.success,fail:function(data,code){if(!alive())return;options.fail(data,typeof code==='number'?code:206);
                    if(onFailure)onFailure({code:typeof code==='number'?code:206,data:data});else exportDiagnostics(function(s){if(alive())report(prefix()+s);});}});}};
            sender=new Transport(adapter,config);sender.report=function(s){if(alive())report(prefix()+s);};
            report(prefix()+'awaiting Mac');if(onReady)onReady();
        }
        function detect(){if(!alive() || detecting)return;detecting=true;report(prefix()+'detecting phone');
            native.detect({bundleName:config.peerPackage,success:openSender,fail:function(d,c){failure('detect',d,c);}});
        }
        function subscribe(){if(!alive())return;native.unsubscribeMsg();
            native.subscribeMsg({success:function(data){if(!alive())return;
                if(!data || data.isRegister){registered=true;detect();return;}
                if(data.isFileType)return;
                try{var text=typeof data==='string'?data:data.message;var m=JSON.parse(text);if(m.v===1 && (m.t==='relay' || m.t==='command'))receive(m);}catch(e){log.add('receive.parse',[e.message]);}
            },fail:function(d,c){failure('register',d,c);}});
        }
        try{
            report('Native initializing');native.getWearEngineVersion({sdkVersion:'3',complete:function(data){
                if(!alive())return;var parts=String(data || '').split('.');version=Number(parts[parts.length-1]);
                if(version<401){failure('unsupported native version',data,version);return;}
                native.setPackageName({appName:config.peerPackage,complete:function(){if(!alive())return;
                    native.setFingerprint({appName:config.peerPackage,appCert:config.peerFingerprint,complete:function(){schedule(subscribe,100);},fail:function(d,c){failure('fingerprint',d,c);}});
                },fail:function(d,c){failure('package',d,c);}});
            }});
            schedule(function(){if(!sender)failure('initialization deadline','no ready',0);},6000);
        }catch(e){failure('init exception',e.message,0);}
    },
    send:function(frame){if(sender)sender.push(frame);},
    logLine:function(index){return log.line(index);},logCount:function(){return log.count();},
    stop:function(){epoch++;cancelExport();for(var i=0;i<timers.length;i++)clearTimeout(timers[i]);timers=[];
        if(sender)sender.stop();sender=null;try{if(registered)native.unsubscribeMsg();}catch(e){}registered=false;}
};
