// Lazy native access; observe raw callbacks before Huawei's SDK maps failures to 206.
import log from './diagnostics';
import config from './config';
var api=null;
function native(){if(!api)api=requireModule('@system.wearengine');return api;}
function call(name,options){
    log.add(name+'.call',name==='sendMsg'?[options.message.length]:[]);
    if(!options)return native()[name]();
    var wrapped={};for(var key in options)wrapped[key]=options[key];
    ['success','fail','complete'].forEach(function(kind){
        if(typeof options[kind]!=='function')return;
        wrapped[kind]=function(){
            if(name==='subscribeMsg' && kind==='success' && arguments[0] && arguments[0].message!==undefined)
                log.add(name+'.message',[String(arguments[0].message).length]);
            else log.add(name+'.'+kind,arguments);
            return options[kind].apply(null,arguments);
        };
    });
    try{return native()[name](wrapped);}catch(e){log.add(name+'.throw',[e.message]);throw e;}
}
var facade={};
['getWearEngineVersion','setPackageName','setFingerprint','subscribeMsg','unsubscribeMsg','detect','sendMsg'].forEach(function(name){facade[name]=function(options){return call(name,options);};});
export function detectRaw(options){return native().detect(options);}
export function probeSend(which,message,complete){
    var selected=null,started=Date.now(),finished=false,timeout=null;
    function done(ok,args){if(finished)return;finished=true;clearTimeout(timeout);var values=[];
        for(var i=0;args && i<Math.min(args.length,2);i++)values.push(typeof args[i]==='number'?args[i]:String(args[i]).slice(0,60));
        complete({api:which,ok:ok,ms:Date.now()-started,argc:args?args.length:0,args:values});
    }
    try{
        if(which==='wearengine')selected=native();
        else if(which==='legacy' && typeof FeatureAbility!=='undefined')selected=FeatureAbility;
        if(!selected || typeof selected.sendMsg!=='function'){complete({api:which,ok:false,error:'API unavailable'});return;}
        timeout=setTimeout(function(){done(false,['callback deadline']);},4500);
        selected.sendMsg({deviceId:'remote',bundleName:config.peerPackage,abilityName:'',message:message,
            success:function(){done(true,arguments);},fail:function(){done(false,arguments);}});
    }catch(e){done(false,[e.message]);}
}
// Diagnostics use the managed RPC channel; retain these entry points for callers.
export function cancelExport(){}
export function resetDiagnostics(){log.reset();}
export function exportDiagnostics(report){if(report)report('Use managed logs');}
export default facade;
