// Offline file integrity and ordering checks; no claim about native playback.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('app/GT4CloudmTest/watch/entry/src/main/js/default/pages/index/index.js','utf8').replace(/^import .*;\n/gm,'').replace('export default','var page=');
function run(corrupt){
 const store={},calls=[];let now=1000,interval;
 const tone=Uint8Array.from({length:5000},(_,i)=>i%251),lib=Uint8Array.from([1,2,3]);
 const file={mkdir(o){o.success();},writeText(o){store[o.uri]=o.text;if(o.success)o.success();},readText(o){o.success({text:store[o.uri]});},writeArrayBuffer(o){assert(o.buffer.length<=2048);store[o.uri]=o.append?[...store[o.uri],...o.buffer]:[...o.buffer];o.success();},readArrayBuffer(o){let b=store[o.uri].slice(o.position,o.position+o.length);if(corrupt)b[0]^=1;o.success({buffer:b});}};
 const audio={play(){assert.equal(store['internal://app/cur_playlist'],'diag_playlist_110');assert.equal(store['internal://app/diag_playlist_110'],'10003.tmp,1,1,2,DiagnosticTone,Local;');assert.deepEqual(store['internal://app/music/10003.tmp'],[...tone]);calls.push('play');},stop(){calls.push('stop');},getPlayState(o){o.success({state:'play',currentTime:(now-1000)/1000,src:this.src});}};
 const ctx={file,lib64:Buffer.from(lib).toString('base64'),tone64:Buffer.from(tone).toString('base64'),decode:s=>Uint8Array.from(Buffer.from(s,'base64')),Uint8Array,Date:{now:()=>now},JSON,brightness:{setKeepScreenOn(){}},managed:{start(){},stop(){},idle:()=>true,emit(){}},bridge:{start(){},stop(){}},requireNative:()=>audio,setInterval(f){interval=f;return 1;},clearInterval(){}};
 vm.createContext(ctx);vm.runInContext(src,ctx);ctx.page.onShow.call(ctx.page);ctx.page.onShow.call(ctx.page);
 for(let i=0;i<45;i++){now+=500;interval();}
 return {ctx,calls};
}
let r=run(false);assert.equal(r.calls.filter(x=>x==='play').length,1);assert.equal(r.ctx.report.phase,'test-complete');assert.equal(r.ctx.report.files.length,2);
r=run(true);assert(!r.calls.includes('play'));assert.equal(r.ctx.report.phase,'failed');
console.log('PASS: chunked file roundtrip; playlist before play; single onShow; bounded stop; corrupt readback blocks playback. Offline only.');
