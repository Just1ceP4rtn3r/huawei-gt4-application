import assert from 'node:assert/strict';
import {crc,encode,decoder} from '../relay/tcp-channel.js';
assert.equal(crc(Array.from(Buffer.from('123456789'))),0x31c3);
let got=[];const feed=decoder((sid,cid,body)=>got.push({sid,cid,body}));
const a=encode(52,1,Array(600).fill(7)),b=encode(52,1,[9]);const stream=[...a,...b];for(let i=0;i<stream.length;i+=11)feed(stream.slice(i,i+11));
assert.equal(got.length,2);assert.equal(got[0].body.length,600);assert.deepEqual(got[1].body,[9]);
const bad=encode(52,1,[1]);bad[6]^=1;assert.throws(()=>decoder(()=>{})(bad),/CRC/);
assert.throws(()=>encode(52,1,Array(48001).fill(0)),/budget/);
console.log('TCP chunking, coalescing, CRC and bounds passed');
