import assert from 'node:assert/strict';
import {decode,parse,tlv,bytes,ack,status,WATCH_PACKAGE,PHONE_PACKAGE,PHONE_FINGERPRINT} from '../relay/protocol.js';
const fp=WATCH_PACKAGE+'_'+Buffer.from([4,...Array(64).fill(1)]).toString('base64');
const payload={v:1,t:'pointer',session:'1-1',seq:1,sent:1000,armed:false,dx:0,dy:0,scroll:0,buttons:[]};
const packet=[...tlv(1,[2]),...tlv(2,[0,1]),...tlv(3,bytes(WATCH_PACKAGE)),...tlv(4,bytes(PHONE_PACKAGE)),...tlv(5,bytes(fp)),...tlv(6,bytes(PHONE_FINGERPRINT)),...tlv(7,bytes(JSON.stringify(payload)))];
assert.equal(decode([...packet,0],fp).payload.seq,1);
const m=decode(packet,fp);assert.equal(m.payload.seq,1);assert.equal(parse(ack(m))[8][3],207);assert.equal(parse(ack({...m,kind:1}))[8][3],205);
assert.equal(JSON.parse(String.fromCharCode(...parse(status(m,3,true))[7])).enabled,true);
assert.throws(()=>decode(packet,'B'.repeat(64)),/fingerprint/);
assert.throws(()=>parse([...tlv(1,[1]),...tlv(1,[2])]),/Duplicate/);
assert.throws(()=>parse([7,127,1]),/Truncated/);
const unrelated=[...tlv(1,[1]),...tlv(2,[0,2]),...tlv(3,bytes('other.app')),...tlv(4,bytes(PHONE_PACKAGE))];
assert.equal(decode(unrelated,fp),null);
console.log('P2P tests passed: route isolation, certificate binding, ACK/status, malformed and duplicate TLV');

const legacy=[...tlv(1,[1]),...tlv(2,[0,9]),...tlv(3,bytes(WATCH_PACKAGE)),...tlv(4,bytes('local.gt4airpointer.relay'))];
const legacyMessage=decode(legacy,fp);assert.ok(legacyMessage);
assert.equal(String.fromCharCode(...parse(ack(legacyMessage))[3]),'local.gt4airpointer.relay');
assert.equal(parse(ack(legacyMessage))[8][3],205);
console.log('Actual legacy-route regression passed: authenticated app route accepted and ACK reverses received peer route');

const route=PHONE_PACKAGE+'.gt4log.s1234abcd.p1n2.x'+Buffer.from('{"v":1,').toString('hex');
const logPing=[...tlv(1,[1]),...tlv(2,[0,12]),...tlv(3,bytes(WATCH_PACKAGE)),...tlv(4,bytes(route))];
const log=decode(logPing,fp);assert.equal(log.payload,null);assert.equal(log.diagnostic.text,'{"v":1,');
assert.equal(String.fromCharCode(...parse(ack(log))[3]),route);assert.equal(parse(ack(log))[8][3],205);
assert.throws(()=>decode([...tlv(1,[1]),...tlv(2,[0,12]),...tlv(3,bytes(WATCH_PACKAGE)),...tlv(4,bytes(route.replace('p1n2','p3n2')))],fp),/diagnostic/);
assert.equal(decode([...tlv(1,[1]),...tlv(2,[0,12]),...tlv(3,bytes('unrelated.app')),...tlv(4,bytes(route))],fp),null);
console.log('Diagnostic ping tests passed: bounded fragments, separate message type, source isolation, exact reverse ACK');
