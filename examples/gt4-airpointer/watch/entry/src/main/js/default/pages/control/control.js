import sensor from '@system.sensor';
import brightness from '@system.brightness';
import Motion from '../../common/motion';
import config from '../../common/config';
import bridge from '../../common/bridge';
import managed from '../../common/managed-link';
import Controller from '../../common/managed-controller';
import diagnosticLog from '../../common/diagnostics';
import {probeSend} from '../../common/native-wearengine';
import application from '@system.app';
var motion=null,timer=null,active=false,view=null,started=0,ticks=0,gyroCount=0,accelCount=0;
var keepScreen=false,relaySeen=0,screenEpoch=0,lastSensorError='',lastA=null,lastG=null;
var controller=null,pointerEnabled=false,lastState=0,lastReady=0,exitTimer=null;
var applicationVersion='unknown',exiting=false,pointerBackend='native';
function now(){return Date.now();}
function errorText(name,code){return name+' unavailable ('+String(code)+')';}
function vector(v){return v?[Math.round(v.x*10000)/10000,Math.round(v.y*10000)/10000,Math.round(v.z*10000)/10000]:null;}
function state(){return {version:applicationVersion,cycle:screenEpoch,screen:'control',a:accelCount,g:gyroCount,av:vector(lastA),gv:vector(lastG),ready:motion.ready,armed:motion.armed,
    calibration:motion.calibrationStatus,mode:motion.mode,gain:motion.gain,pointer:pointerEnabled,backend:pointerBackend,error:lastSensorError || ''};}
function brief(){return {version:applicationVersion,cycle:screenEpoch,a:accelCount,g:gyroCount,ready:motion.ready,armed:motion.armed};}
function emit(event,session,id,data){managed.emit(event,session,id,data);}
function execute(op,args,done){
    if(exiting && op!=='status' && op!=='pause'){done(null,'Application is exiting');return;}
    if(op==='hello' || op==='status'){done(state());return;}
    if(op==='calibrate'){motion.calibrate(now());render();done(state());return;}
    if(op==='arm'){if(!motion.ready){done(null,'Calibration is not ready');return;}motion.setArmed(true);render();done(brief());return;}
    if(op==='pause'){motion.setArmed(false);if(pointerEnabled && pointerBackend==='experimental-ping')managed.pointer({armed:false,dx:0,dy:0,scroll:0,buttons:[]},false);pointerEnabled=false;render();done(state());return;}
    if(op==='mode'){if(['pointer','scroll'].indexOf(args.value)<0){done(null,'Invalid mode');return;}motion.setMode(args.value);render();done(state());return;}
    if(op==='gain'){if([0.6,1,1.6].indexOf(args.value)<0){done(null,'Invalid gain');return;}motion.gain=args.value;render();done(state());return;}
    if(op==='button'){done({queued:motion.button(args.kind,now())});return;}
    if(op==='pointer'){
        if(args.backend!==undefined && ['native','experimental-ping'].indexOf(args.backend)<0){done(null,'Invalid pointer backend');return;}
        if(args.backend)pointerBackend=args.backend;pointerEnabled=args.enabled===true;motion.setArmed(false);done(state());return;
    }
    if(op==='probe'){
        motion.setArmed(false);pointerEnabled=false;
        if(['wearengine','legacy','legacy-module'].indexOf(args.api)<0){done(null,'Invalid probe API');return;}
        var probe=JSON.stringify({v:1,t:'probe',id:controller.lastID});
        probeSend(args.api,probe,function(result){if(active)done(result);});return;
    }
    if(op==='logs'){
        var data=JSON.parse(diagnosticLog.snapshot());
        while(JSON.stringify(data).length>640 && data.events.length>1)data.events.shift();done(data);return;
    }
    if(op==='test'){
        if(args.scenario==='cursor'){
            if(!controller.enabled){done(null,'Desktop input is disabled');return;}
            var dx=typeof args.dx==='number' && isFinite(args.dx)?Math.max(-8,Math.min(8,args.dx)):4;
            var dy=typeof args.dy==='number' && isFinite(args.dy)?Math.max(-8,Math.min(8,args.dy)):0;
            managed.pointer({armed:true,dx:dx,dy:dy,scroll:0,buttons:[]},true);
            done({queued:true,origin:'synthetic-watch-test',backend:'experimental-ping',dx:dx,dy:dy});return;
        }
        if(args.backend==='experimental-ping')managed.pointer({armed:false,dx:0,dy:0,scroll:0,buttons:[]},true);
        else bridge.send({armed:false,dx:0,dy:0,scroll:0,buttons:[],origin:'managed-transport-test'});
        done({queued:true,origin:'managed-transport-test'});return;
    }
    if(op==='exit'){
        exiting=true;managed.quiesce();motion.setArmed(false);pointerEnabled=false;done({exiting:true});
        var attempts=0;
        function finish(){if(!active)return;if(!managed.idle() && ++attempts<200){exitTimer=setTimeout(finish,100);return;}stop();application.terminate();}
        exitTimer=setTimeout(finish,200);return;
    }
    done(null,'Unknown command');
}
function render() {
    if(!view || !motion)return;
    view.action=motion.armed?'Pause':'Resume';view.mode=motion.mode==='scroll'?'Scroll':'Pointer';
    view.calibration=motion.calibrationStatus;view.sensorText=lastSensorError || (motion.gyroAvailable?'GYRO':'TILT')+' · A '+accelCount+' / G '+gyroCount;
}
function stop() {
    if(!active)return;active=false;screenEpoch++;
    if(motion)motion.setArmed(false);
    bridge.send({armed:false,dx:0,dy:0,scroll:0,buttons:[]});
    clearInterval(timer);timer=null;
    try{sensor.unsubscribeAccelerometer();}catch(e){}
    try{sensor.unsubscribeGyroscope();}catch(e){}
    bridge.stop();managed.stop();if(controller)controller.stop();pointerEnabled=false;clearTimeout(exitTimer);relaySeen=0;
    if(keepScreen){try{brightness.setKeepScreenOn({keepScreenOn:false});}catch(e){}keepScreen=false;}
    if(view){view.linkText='Disconnected';view.macText='Mac not confirmed';render();}
}
export default {
    data:{calibration:'Calibrate first',action:'Resume',mode:'Pointer',gainText:'Speed 1x',linkText:'Preview only',macText:'Mac not confirmed',
        sensorText:'Waiting for sensors'},
    onInit:function(){motion=new Motion(config);view=this;controller=new Controller(execute,emit,now);try{applicationVersion=application.getInfo().versionName || 'unknown';}catch(e){}},
    onShow:function(){
        if(active)return;active=true;var currentEpoch=++screenEpoch;view=this;started=now();gyroCount=0;accelCount=0;relaySeen=0;lastSensorError='';
        motion.setArmed(false);this.linkText='Preview only';
        try{sensor.subscribeAccelerometer({interval:config.interval,success:function(v){if(active && currentEpoch===screenEpoch){accelCount++;lastA={x:v.x,y:v.y,z:v.z};motion.accelerometer(v,now());}},fail:function(d,c){if(active && currentEpoch===screenEpoch)lastSensorError=errorText('Accel',c);}});}catch(e){this.sensorText='Accel API unavailable';}
        try{sensor.subscribeGyroscope({interval:config.interval,success:function(v){if(active && currentEpoch===screenEpoch){gyroCount++;lastG={x:v.x,y:v.y,z:v.z};motion.gyroscope(v,now());}},fail:function(d,c){if(active && currentEpoch===screenEpoch){motion.setGyroAvailable(false);lastSensorError=errorText('Gyro',c);}}});}catch(e){motion.setGyroAvailable(false);}
        keepScreen=true;try{brightness.setKeepScreenOn({keepScreenOn:true,success:function(){if(active && currentEpoch===screenEpoch)keepScreen=true;else if(!active){try{brightness.setKeepScreenOn({keepScreenOn:false});}catch(e){}}}});}catch(e){}
        timer=setInterval(function(){
            if(!active)return;
            if(gyroCount===0 && now()-started>1300 && motion.gyroAvailable)motion.setGyroAvailable(false);
            if(motion.armed && pointerEnabled && controller.expired()){motion.setArmed(false);diagnosticLog.add('lease.expired',[]);}
            var f=motion.frame(now());
            if(pointerEnabled){if(pointerBackend==='experimental-ping')managed.pointer(f,false);else bridge.send(f);}
            if(!exiting && now()-lastReady>12000 && managed.idle()){
                lastReady=now();managed.emit('ready','',0,brief());
            }else if(!exiting && controller.session && now()-lastState>10000 && managed.idle()){
                lastState=now();managed.emit('state',controller.session,0,brief());
            }
            if(relaySeen && now()-relaySeen>1800){view.macText='Waiting for Mac';relaySeen=0;if(!controller.session || controller.expired())motion.setArmed(false);}
            if(++ticks%4===0)render();
        },config.frameMs);
        render();
        this.connect();
    },
    onHide:stop,onDestroy:stop,
    calibrate:function(){motion.calibrate(now());render();},
    toggle:function(){motion.setArmed(!motion.armed);render();},
    connect:function(){
        exiting=false;motion.setArmed(false);pointerEnabled=false;controller.stop();managed.start(function(s){if(view)view.linkText=s;});
        bridge.start(function(s){if(view)view.linkText=s;},function(m){
            if(m.t==='command'){controller.receive(m);return;}
            relaySeen=now();if(view)view.macText=m.enabled?'Mac enabled': 'Mac dry-run';
        },function(){lastReady=now();managed.emit('ready','',0,brief());},function(result){
            motion.setArmed(false);pointerEnabled=false;managed.emit('probe',controller.session,0,{api:'sdk',code:result.code});
        });render();
    },
    left:function(){motion.button('left',now());},right:function(){motion.button('right',now());},
    drag:function(){motion.button('drag',now());},double:function(){motion.button('double',now());},
    switchMode:function(){motion.setMode(motion.mode==='scroll'?'pointer':'scroll');render();},
    speed:function(){motion.gain=motion.gain===1?1.6:(motion.gain===1.6?0.6:1);this.gainText='Speed '+motion.gain+'x';},
};
