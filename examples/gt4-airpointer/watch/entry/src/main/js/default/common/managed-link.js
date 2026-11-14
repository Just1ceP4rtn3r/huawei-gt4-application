// Serialized native detect channel: management messages plus explicit experimental pointer fallback.
import {detectRaw} from './native-wearengine';
import config from './config';
import log from './diagnostics';
import PointerBeacon from './pointer-beacon';
var boot=('00000000'+(Date.now()>>>0).toString(16)).slice(-8),sequence=0,epoch=0;
var queue=[],busy=false,timer=null,active=false,report=function(){},pointer=new PointerBeacon(config.peerPackage),pointerBurst=0;
function remove(item){var i=queue.indexOf(item);if(i>=0)queue.splice(i,1);}
function flush(){
    if(!active || busy)return;
    var item=queue[0],route=null,isPointer=false;
    if(pointer.pending && (pointer.pending.synthetic || pointer.pending.buttons.length || !item || (item.event!=='ack' && pointerBurst<2))){route=pointer.take(Date.now());isPointer=!!route;}
    if(!route){
        if(!item)return;
        var part=item.parts[item.position],hex='';for(var i=0;i<part.length;i++)hex+=('0'+part.charCodeAt(i).toString(16)).slice(-2);
        route=config.peerPackage+'.gt4rpc.s'+item.token+'.p'+(item.position+1)+'n'+item.parts.length+'.x'+hex;
    }
    busy=true;var generation=epoch,completed=false;
    function done(ok){
        if(completed || generation!==epoch || !active)return;completed=true;clearTimeout(timer);busy=false;
        if(isPointer){pointerBurst++;if(!ok)log.add('pointer.beacon.failed',[]);}
        else {
            pointerBurst=0;
            if(ok){item.position++;item.retries=0;if(item.position===item.parts.length){remove(item);report('Managed link ready');}}
            else if(item.retries++>=1){remove(item);log.add('managed.export.failed',[item.seq,item.position+1]);report('Managed uplink blocked');}
        }
        timer=setTimeout(flush,ok?60:300);
    }
    timer=setTimeout(function(){done(false);},2000);
    try{detectRaw({bundleName:route,success:function(){done(true);},fail:function(){done(false);}});}catch(e){done(false);}
}
export default {
    boot:boot,
    start:function(onReport){this.stop();active=true;report=onReport || function(){};pointer=new PointerBeacon(config.peerPackage);},
    emit:function(event,session,id,data){
        if(!active)return false;
        var value={v:1,t:'rpc',boot:boot,seq:++sequence,event:event,session:session || '',id:id || 0,data:data || {}};
        var text=JSON.stringify(value);if(text.length>960){log.add('managed.oversize',[event,text.length]);return false;}
        if(event==='state')for(var i=queue.length-1;i>=0;i--)if(queue[i].event==='state')queue.splice(i,1);
        if(queue.length>=8){log.add('managed.backpressure',[event]);return false;}
        var parts=[];for(var offset=0;offset<text.length;offset+=48)parts.push(text.slice(offset,offset+48));
        var item={parts:parts,position:0,retries:0,event:event,seq:value.seq,token:('00000000'+((Date.now()+value.seq)>>>0).toString(16)).slice(-8)};
        if(event==='ack')queue.unshift(item);else queue.push(item);flush();return true;
    },
    pointer:function(frame,synthetic){if(!active)return false;pointer.push(frame,Date.now(),synthetic);flush();return true;},
    idle:function(){return !busy && !queue.length && !pointer.pending;},
    quiesce:function(){pointer.clear();for(var i=queue.length-1;i>=0;i--)if(queue[i].event==='state' || queue[i].event==='ready')queue.splice(i,1);},
    stop:function(){epoch++;active=false;queue=[];busy=false;pointer.clear();clearTimeout(timer);timer=null;}
};
