import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const base=new URL('../',import.meta.url),fixture=fs.readFileSync(new URL('test-data/rawfile-demo-02.bin',base));
const lc=vm.createContext({Uint8Array});vm.runInContext(fs.readFileSync(new URL('watch/entry/src/main/js/default/common/audio-lib.js',base),'utf8').replace('export default','globalThis.lib='),lc);const lib=lc.lib;assert.deepEqual(Buffer.from(lib),fixture);
const src=fs.readFileSync(new URL('watch/entry/src/main/js/default/common/rawfile-test.js',base),'utf8').replace("import file from '@system.file';",'').replace("import lib from './audio-lib';",'').replace('export default','globalThis.test=');
for(const mode of ['text','binary','error','corrupt','silent']){
 let now=0,saved,inside=false;const updates=[];
 function write(o,isText){assert.equal(inside,false);inside=true;
  assert.equal(o.uri,'internal://app/a.bin');if(mode==='error'){o.fail('missing',301);}else if(mode!=='silent'){saved=isText?o.text:new Uint8Array(o.buffer);o.success();}inside=false;
 }
 const file={writeText:o=>write(o,true),writeArrayBuffer:o=>write(o,false),readText:o=>{assert.equal(inside,false);o.success({text:mode==='corrupt'?'wrong':saved});},readArrayBuffer:o=>{assert.equal(inside,false);o.success({buffer:saved});}};
 const c=vm.createContext({file,lib,Date:{now:()=>now}});vm.runInContext(src,c);c.test.start(s=>updates.push(s),{method:mode==='binary'?'binary':'text'});
 for(let i=0;i<30;i++){now+=250;c.test.tick();}
 const r=c.test.snapshot();assert.equal(r.phase,['error','corrupt','silent'].includes(mode)?'failed':'verified',mode);
 if(mode==='silent')assert.match(r.error,/timeout/);if(mode==='binary')assert.deepEqual(Buffer.from(saved),fixture);assert.ok(updates.length>=2);
}
console.log('File state-machine tests passed: root text/binary, byte equality, callbacks not nested, timeout and errors.');
