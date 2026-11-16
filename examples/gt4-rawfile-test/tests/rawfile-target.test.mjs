import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../watch/entry/src/main/js/default/common/rawfile-target-test.js',import.meta.url),'utf8').replace("import file from '@system.file';",'').replace('export default','globalThis.api=');
function fixture(mode='ok') {
 let now=0,stored=new Uint8Array(1180).fill(99),writes=0;
 const context={Uint8Array,JSON,Date:{now:()=>now},file:{
  get(o){o.success({type:'file',length:stored.length});},
  writeArrayBuffer(o){writes++;assert.equal(o.uri,'internal://app/rawfile/lib/audio_decode_m55.bin');assert.equal(o.position,0);assert.equal(o.append,false);if(mode==='write-failure'){o.fail('File or directory not exist',301);return;}if(mode==='timeout')return;stored.set(o.buffer);o.success();},
  readArrayBuffer(o){let b=stored.slice(o.position,o.position+o.length);if(mode==='corrupt')b[100]^=1;if(mode==='short')b=b.slice(0,255);o.success({buffer:b});}
 }};
 vm.createContext(context);vm.runInContext(source,context);
 return {api:context.api,advance(){now+=10000;},get stored(){return stored;},get writes(){return writes;}};
}
function run(f){assert.equal(f.api.start(()=>{}),true);for(let i=0;i<6;i++)f.api.tick();return f.api.snapshot();}
test('verifies all 256 binary bytes without claiming truncation',()=>{const f=fixture();assert.equal(run(f).phase,'verified');assert.equal(f.stored.length,1180);assert.equal(f.stored[256],99);assert.deepEqual(Array.from(f.stored.slice(0,256)),Array.from({length:256},(_,i)=>i));});
for(const mode of ['corrupt','short','write-failure'])test('does not verify '+mode,()=>{assert.notEqual(run(fixture(mode)).phase,'verified');});
test('reports stalled native call and continues without hanging',()=>{const f=fixture('timeout');f.api.start(()=>{});f.api.tick();f.api.tick();f.advance();f.api.tick();f.api.tick();const r=f.api.snapshot();assert.equal(r.phase,'complete');assert.ok(r.results.some(x=>x.includes('timeout')));});
test('rejects remote paths outside app sandbox or containing traversal',()=>{for(const uri of ['internal://cache/a.bin','internal://app/../a.bin']){const f=fixture();assert.equal(f.api.start(()=>{},{ops:[['writeBinary',uri]]}),false);assert.equal(f.writes,0);}});
