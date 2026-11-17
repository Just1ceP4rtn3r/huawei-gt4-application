import file from '@system.file';
var root='internal://app/',target=root+'rawfile/lib/audio_decode_m55.bin',marker='GT4_TARGET_MARKER_1637_20261117\n';
var defaults=[['get',target],['writeBinary',target],['readBinary',target]];
var binary=new Uint8Array(256);for(var z=0;z<256;z++)binary[z]=z;
var ops=[],index=0,active=false,pending=false,deadline=0,changed=null,token=0;
var r={phase:'not-run',uri:target,bytes:256,method:'binary-target-test',step:'start',error:'',results:[]};
function snapshot(){return {phase:r.phase,uri:target,bytes:r.bytes,method:r.method,step:r.step,error:r.error,results:r.results.slice(0)};}
function notify(){if(changed)changed(snapshot());}
function advance(message){pending=false;r.results.push(message);index++;if(index===ops.length){active=false;r.phase='complete';}notify();}
function tick(){
 if(!active)return;if(pending){if(Date.now()>deadline){token++;advance(r.step+' timeout');}return;}
 var op=ops[index],label=index+' '+op[0]+' '+op[1],current=++token;r.step=label;pending=true;deadline=Date.now()+8000;
 var opts={uri:op[1],success:function(data){if(current!==token)return;
  if(op[0]==='readBinary'){var got=data&&data.buffer,ok=got&&got.length===binary.length;if(ok)for(var j=0;j<binary.length;j++)if(got[j]!==binary[j]){ok=false;break;}if(ok&&op[1]===target){r.results.push(label+' EXACT 256 BINARY BYTES VERIFIED');r.phase='verified';active=false;pending=false;notify();return;}advance(label+' BINARY MISMATCH length='+(got?got.length:0));return;}
  if(op[0]==='read'&&op[1]===target&&data&&data.text===marker){r.results.push(label+' EXACT MARKER VERIFIED');r.phase='verified';active=false;pending=false;notify();return;}
  advance(label+' OK '+(data?JSON.stringify(data).slice(0,330):''));
 },fail:function(data,code){if(current===token)advance(label+' FAIL '+code+' '+String(data).slice(0,100));}};
 try{if(op[0]==='writeBinary'){opts.buffer=binary;opts.position=0;opts.append=false;file.writeArrayBuffer(opts);}else if(op[0]==='readBinary'){opts.position=0;opts.length=256;file.readArrayBuffer(opts);}else if(op[0]==='write'){opts.text=marker;opts.append=false;file.writeText(opts);}else if(op[0]==='read'){opts.position=0;opts.length=256;file.readText(opts);}else if(op[0]==='mkdir'){opts.recursive=!!op[2];file.mkdir(opts);}else if(op[0]==='list')file.list(opts);else if(op[0]==='get')file.get(opts);else if(op[0]==='copy'||op[0]==='move'){opts.srcUri=op[1];opts.dstUri=op[2];if(op[0]==='copy')file.copy(opts);else file.move(opts);}}
 catch(e){if(current===token)advance(label+' exception '+String(e));}
}
function allowed(uri){return typeof uri==='string'&&uri.indexOf(root)===0&&uri.indexOf('..')<0&&uri.length<120;}
function start(callback,options){if(active)return false;options=options||{};var plan=options.ops||defaults;
 if(!plan.length||plan.length>30)return false;for(var i=0;i<plan.length;i++){if(!allowed(plan[i][1])||(('copy move').indexOf(plan[i][0])>=0&&!allowed(plan[i][2])))return false;if(['get','list','mkdir','write','read','copy','move','writeBinary','readBinary'].indexOf(plan[i][0])<0)return false;}
 changed=callback;ops=plan;index=0;active=true;pending=false;token++;r.phase='checking';r.error='';r.results=[];notify();return true;}
export default {start:start,tick:tick,snapshot:snapshot};
