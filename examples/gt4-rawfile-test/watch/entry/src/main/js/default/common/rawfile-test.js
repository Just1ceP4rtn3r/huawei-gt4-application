import file from '@system.file';
var total=102400,chunk=1024,offset=0,active=false,pending=false,deadline=0,changed=null,next='write';
var r={phase:'not-run',uri:'internal://app/a.bin',bytes:total,method:'binary',step:'start',error:'',results:[]};
function snapshot(){return {phase:r.phase,uri:r.uri,bytes:r.bytes,method:r.method,step:r.step,error:r.error,results:r.results.slice(0)};}
function notify(){if(changed)changed(snapshot());}
function finish(phase,error){active=false;pending=false;r.phase=phase;r.error=error||'';notify();}
function fail(data,code){finish('failed',r.step+': '+code+' '+String(data));}
function expected(pos){return (pos*17+Math.floor(pos/1024)+34)%256;}
function tick(){
 if(!active)return;if(pending){if(Date.now()>deadline)finish('failed',r.step+' timeout');return;}
 pending=true;deadline=Date.now()+10000;r.step=next+' '+offset+'/'+total;r.error='';
 try{
 if(next==='write'){
  var buffer=new Uint8Array(chunk);for(var i=0;i<chunk;i++)buffer[i]=expected(offset+i);
  file.writeArrayBuffer({uri:r.uri,buffer:buffer,append:offset>0,success:function(){pending=false;offset+=chunk;if(offset===total){r.results.push('write 102400 bytes OK');offset=0;next='stat';}notify();},fail:fail});
 }else if(next==='stat'){
  file.get({uri:r.uri,success:function(data){pending=false;if(!data||data.length!==total){finish('failed','size mismatch '+JSON.stringify(data));return;}r.results.push('size 102400 OK');next='read';notify();},fail:fail});
 }else{
  file.readArrayBuffer({uri:r.uri,position:offset,length:chunk,success:function(data){pending=false;var b=data&&data.buffer;if(!b||b.length!==chunk){finish('failed','read length mismatch at '+offset);return;}for(var i=0;i<chunk;i++)if(b[i]!==expected(offset+i)){finish('failed','content mismatch at '+(offset+i));return;}offset+=chunk;if(offset===total){r.results.push('read/compare 102400 bytes OK');finish('verified');}else notify();},fail:fail});
 }
 }catch(e){fail(String(e),-1);}
}
function start(callback){if(active)return false;changed=callback;offset=0;next='write';pending=false;active=true;r.phase='checking';r.step='write';r.error='';r.results=[];notify();return true;}
export default {start:start,tick:tick,snapshot:snapshot};
