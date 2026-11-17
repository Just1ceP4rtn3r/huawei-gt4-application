import file from '@system.file';
var base='internal://app/rawfile',target=base+'/lib/audio_decode_m55.bin';
var ops=[['get',base],['get',base+'/lib'],['get',target],['read',target],['list',base],['list',base+'/lib'],['read','internal://app/a.bin']];
var index=0,active=false,pending=false,deadline=0,changed=null;
var r={phase:'not-run',uri:target,bytes:0,method:'read-probe',step:'start',error:'',results:[]};
function snapshot(){return {phase:r.phase,uri:r.uri,bytes:r.bytes,method:r.method,step:r.step,error:r.error,results:r.results.slice(0)};}
function notify(){if(changed)changed(snapshot());}
function advance(message){pending=false;r.results.push(message);index++;if(index===ops.length){active=false;r.phase='complete';}notify();}
function tick(){
 if(!active)return;if(pending){if(Date.now()>deadline)advance(r.step+' timeout');return;}
 var op=ops[index];r.step=op[0]+' '+op[1];pending=true;deadline=Date.now()+8000;
 var opts={uri:op[1],success:function(data){
  if(op[0]==='read'){var b=data&&data.buffer;var hex='';if(b)for(var i=0;i<b.length&&i<64;i++){var n=b[i].toString(16);hex+=(n.length<2?'0':'')+n;}advance(r.step+' OK bytes='+(b?b.length:0)+' hex='+hex);}
  else advance(r.step+' OK '+JSON.stringify(data).slice(0,500));
 },fail:function(data,code){advance(r.step+' FAIL '+code+' '+String(data));}};
 try{if(op[0]==='read'){opts.position=0;opts.length=64;file.readArrayBuffer(opts);}else if(op[0]==='list')file.list(opts);else file.get(opts);}catch(e){advance(r.step+' exception '+String(e));}
}
function start(callback){if(active)return false;changed=callback;index=0;active=true;pending=false;r.phase='checking';r.error='';r.results=[];notify();return true;}
export default {start:start,tick:tick,snapshot:snapshot};
