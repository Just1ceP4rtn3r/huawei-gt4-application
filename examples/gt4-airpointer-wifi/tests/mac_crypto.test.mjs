import assert from 'node:assert/strict';
import {gcm} from '../../../tools/frida-agent/node_modules/@noble/ciphers/aes.js';
import {sealFrame,unsealFrame} from '../relay/mac-crypto.mjs';
import {parse,tlv} from '../relay/protocol.js';
for(const size of [16,24,32]){
 const key=Buffer.alloc(size,0x31),plain=[1,1,2,2,2,0,1];
 const frame=sealFrame(key,plain),f=parse(frame);
 assert.deepEqual([...gcm(key,new Uint8Array(f[125])).decrypt(new Uint8Array(f[126]))],plain);
 const iv=new Uint8Array(16).fill(9),cipher=gcm(key,iv).encrypt(new Uint8Array(plain));
 assert.deepEqual(unsealFrame(key,[...tlv(124,[1]),...tlv(125,[...iv]),...tlv(126,[...cipher])]),plain);
 const corrupt=frame.slice();corrupt[corrupt.length-1]^=1;assert.throws(()=>unsealFrame(key,corrupt));
 assert.notDeepEqual(parse(sealFrame(key,plain))[125],f[125]);
}
assert.throws(()=>unsealFrame(Buffer.alloc(16),[124,1,0]));
console.log('Mac/phone AES-GCM interoperability, tamper rejection, key sizes and fresh nonces passed');
