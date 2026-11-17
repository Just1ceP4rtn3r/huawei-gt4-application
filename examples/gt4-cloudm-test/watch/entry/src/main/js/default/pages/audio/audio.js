import file from '@system.file';
import brightness from '@system.brightness';
import managed from '../../common/audio-ble';
import {lib64,tone64,decode} from '../../common/audio-data';
var root='internal://app/',audio=null,view=null,timer=null,started=false,begin=0,lastPoll=0,attempts=0,exitAt=0,exitAck=null;
var report={test:'CLOUDM-AUDIO',version:'1.0.20',run:String(Date.now()),phase:'init',files:[],events:[],states:[],errors:0};
function save(){try{file.writeText({uri:root+'audio-result-1.0.20.json',text:JSON.stringify(report),append:false});}catch(e){}}
function update(phase){report.phase=phase;view.status=phase;}
function error(where,d,c){report.failure={where:where,detail:String(d),code:String(c)};update('failed');}
var deferred=null,deadline=0;
function later(next){deferred=next;deadline=Date.now()+10000;}
function stage(name){report.step=name;deadline=Date.now()+10000;}
function dir(uri,next){stage('mkdir '+uri.slice(15));file.mkdir({uri:uri,recursive:false,success:function(){later(next);},fail:function(){later(function(){file.get({uri:uri,success:function(d){if(d.type==='dir')later(next);else error('directory',uri,-1);},fail:function(d,c){error('directory',d,c);}});});}});}
function text(uri,value,next){stage('text-write '+uri.slice(15));file.writeText({uri:uri,text:value,append:false,success:function(){later(function(){stage('text-read '+uri.slice(15));file.readText({uri:uri,position:0,length:value.length,success:function(d){if(d.text===value){report.texts=(report.texts||0)+1;later(next);}else error('text-readback',String(d.text),-1);},fail:function(d,c){error('text-read',d,c);}});});},fail:function(d,c){error('text-write',d,c);}});}
function binary(uri,bytes,next,repeat){
 var offset=0,total=bytes.length*(repeat||1);
 function write(){stage('binary-write '+offset);var n=Math.min(2048,total-offset),part=new Uint8Array(n);for(var i=0;i<n;i++)part[i]=bytes[(offset+i)%bytes.length];
 file.writeArrayBuffer({uri:uri,buffer:part,append:offset>0,success:function(){offset+=n;if(offset<total)later(write);else{offset=0;later(read);}},fail:function(d,c){error('binary-write',d,c);}});}
 function read(){stage('binary-read '+offset);var n=Math.min(2048,total-offset);file.readArrayBuffer({uri:uri,position:offset,length:n,success:function(d){var got=d.buffer;if(typeof got.length!=='number')got=new Uint8Array(got);if(got.length!==n){error('binary-length',uri,got.length);return;}for(var i=0;i<n;i++)if(got[i]!==bytes[(offset+i)%bytes.length]){error('binary-content',uri,offset+i);return;}offset+=n;if(offset<total)later(read);else{report.files.push({name:uri.slice(15),bytes:total,exact:true});later(next);}},fail:function(d,c){error('binary-read',d,c);}});}
 write();
}
function event(name){if(name==='onerror')report.errors++;if(report.events.length<14)report.events.push(name);}
function sample(){try{audio.getPlayState({success:function(d){var s={t:Math.round((Date.now()-begin)/1000),state:d.state,src:d.src,time:d.currentTime};if(report.states.length<12)report.states.push(s);view.detail=d.state+' t='+d.currentTime;},fail:function(d,c){error('state',d,c);}});}catch(e){error('state-exception',e,-1);}}
function play(){
 try{audio=requireNative('system.audio');audio.onplay=function(){event('onplay');};audio.onended=function(){event('onended');};audio.onpause=function(){event('onpause');};audio.onstop=function(){event('onstop');};audio.onerror=function(){event('onerror');};
 audio.autoplay=false;audio.loop=false;audio.muted=false;audio.volume=0.5;
 audio.src=root+'music/10020.tmp';report.assignedSrc=String(audio.src);begin=Date.now();lastPoll=begin;update('source-preparing');
 }catch(e){error('play',e,-1);}
}
function tick(){
 var now=Date.now();
 if(exitAck&&managed.idle()){managed.emit('ack',exitAck.session,exitAck.id,{ok:true,version:'1.0.20'});exitAck=null;exitAt=now+4000;}
 if(exitAt&&now>=exitAt){requireNative('system.app').terminate();return;}
 if(begin&&(attempts===0&&now-begin>=2500)){attempts++;report.attempts=attempts;report.volume=0.5;report.expectedDuration=7.522;try{audio.play();update('playing-test');}catch(e){error('delayed-play',e,-1);}}
 if(deferred&&report.phase!=='failed'){var next=deferred;deferred=null;try{next();}catch(e){error('deferred-exception',e,-1);}}
 if(deadline&&now>deadline&&report.phase==='init'){error('callback-timeout',report.step,-1);}
 if(begin && now-lastPoll>=2000 && report.phase==='playing-test'){lastPoll=now;sample();if(now-begin>=20000){try{audio.stop();}catch(e){}update('test-complete');save();}}
 if(managed.idle()){var encoded=JSON.stringify(report);if(encoded.length<900)managed.emit('state','',0,report);else{
  var minimal={test:report.test,version:report.version,run:report.run,phase:report.phase,files:report.files,errors:report.errors,events:report.events,states:report.states.slice(-2),failure:report.failure,step:report.step,texts:report.texts,attempts:report.attempts,control:report.control,volume:report.volume,expectedDuration:report.expectedDuration};managed.emit('state','',0,minimal);
 }}
}
export default {
 data:{status:'Cloudm audio 1.0.20',detail:'Preparing audible tone'},
 onShow:function(){if(started)return;started=true;view=this;managed.start(function(m){if(m.t==='command'&&m.op==='exit'&&m.args&&m.args.version==='1.0.20'){report.phase='exiting';report.command=m.op;exitAck={session:m.session,id:m.id};}},function(s){report.control=s;});try{brightness.setKeepScreenOn({keepScreenOn:true});}catch(e){}timer=setInterval(tick,500);
 dir(root+'rawfile',function(){dir(root+'rawfile/lib',function(){binary(root+'rawfile/lib/audio_decode_m55.bin',decode(lib64),function(){dir(root+'music',function(){binary(root+'music/10020.tmp',decode(tone64),function(){
 text(root+'diag_playlist_120','10020.tmp,1,0,8,DiagnosticTone,Local;',function(){text(root+'cur_playlist','diag_playlist_120',function(){update('prepared');play();});});
 },32);});});});});
 },
 onDestroy:function(){clearInterval(timer);managed.stop();try{if(audio)audio.stop();brightness.setKeepScreenOn({keepScreenOn:false});}catch(e){}}
};
