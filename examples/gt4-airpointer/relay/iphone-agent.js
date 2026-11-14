// GT4AirPointer memory-only P2P adapter, adapted from scripts/phone-bridge.js (AGPL-3.0-or-later).
// Protocol framing follows Gadgetbridge / HuaSideload (AGPL-3.0); see docs/SOURCES.md.
import ObjC from '../../../tools/frida-agent/node_modules/frida-objc-bridge/index.js';
import { gcm } from '../../../tools/frida-agent/node_modules/@noble/ciphers/aes.js';

import {decode,ack,status,parse,ascii,tlv as p2ptlv,bytes,WATCH_PACKAGE,PHONE_PACKAGE,PHONE_FINGERPRINT} from './protocol.js';
import {decodePointerRoute} from './pointer-beacon.js';
const diagnostics={p2pPackets:0,routeMatches:0,ackSent:0,ackFailed:0,lastHeaders:[],wireFrames:0,frameFlags:{},packetTypes:{},wireTail:[],notificationTypes:{}};
function wireEvent(value){diagnostics.wireTail.push({at:Date.now(),...value});if(diagnostics.wireTail.length>32)diagnostics.wireTail.shift();}
let expectedFingerprint=null,lastRoute=null,statusSequence=Math.floor(Math.random()*32000)+1,desktopEnabled=false;
function nextSequence(){statusSequence=statusSequence%32766+1;return statusSequence;}
const getIvar = new NativeFunction(Module.getGlobalExportByName('class_getInstanceVariable'), 'pointer', ['pointer', 'pointer']);
const getOffset = new NativeFunction(Module.getGlobalExportByName('ivar_getOffset'), 'long', ['pointer']);
const random = new NativeFunction(Module.getGlobalExportByName('SecRandomCopyBytes'), 'int', ['pointer', 'ulong', 'pointer']);
function field(object, name) {
  const ivar = getIvar(object.$class.handle, Memory.allocUtf8String(name));
  if (ivar.isNull()) throw Error('Missing field: ' + name);
  return object.handle.add(Number(getOffset(ivar)));
}
function objectField(object, name) {
  const address = field(object, name).readPointer();
  if (address.isNull()) throw Error('Empty field: ' + name);
  return new ObjC.Object(address);
}
const owners = ObjC.chooseSync(ObjC.classes['CrescentRelay.WatchTransport']);
if (owners.length !== 1) throw Error('Expected one existing WatchTransport');
const owner = owners[0];
const session = objectField(owner, 'session');
const peripheral = objectField(owner, 'peripheral');
const writer = objectField(owner, 'writer');
const generation = field(owner, 'generation').readU64().toString();
// Cache addresses before installing hooks. RPC statistics must not enter ObjC/runtime locks.
const connectionSlots={generation:field(owner,'generation'),ownerPaired:field(owner,'isPaired'),sessionPaired:field(session,'isPaired'),ready:field(owner,'channelReady'),key:field(session,'sessionKey')};
let reserved = false, previousIdleTimer = null, receiving = [], slices = [], sliceSID, sliceCID, nextSlice;
let pendingWrites = [], activeWrite = null;
const writeType = Number(writer.properties()) & 8 ? 0 : 1;
const frameLimit = Math.min(182, Number(peripheral.maximumWriteValueLengthForType_(writeType)));
function onMain(fn) { return new Promise((resolve, reject) => ObjC.schedule(ObjC.mainQueue, () => { try { resolve(fn()); } catch(e) { reject(e); } })); }
// Pure memory checks: calling CoreBluetooth getters from RPC while a delegate hook waits for JS can deadlock.
function valid() {
  if (connectionSlots.generation.readU64().toString() !== generation ||
      connectionSlots.ownerPaired.readU8() !== 1 || connectionSlots.sessionPaired.readU8() !== 1 ||
      connectionSlots.ready.readU8() !== 1) throw Error('Paired connection changed');
}
function key() {
  valid();
  const buffer = connectionSlots.key.readPointer();
  if (buffer.isNull()) throw Error('No current session key');
  const count = Number(buffer.add(16).readU64());
  if (![16, 24, 32].includes(count)) throw Error('Unexpected key storage layout');
  return new Uint8Array(buffer.add(32).readByteArray(count));
}
function varint(n) { let out=[n & 127]; while(n >>= 7) out.unshift((n & 127)|128); return out; }
function tlv(tag, bytes) { return [tag, ...varint(bytes.length), ...bytes]; }
function parseTLV(bytes) {
  const out={}; let i=0;
  while(i<bytes.length) {
    const tag=bytes[i++]; if(i===bytes.length && tag===0) break;
    let length=0,b;
    do { if(i>=bytes.length) throw Error('Truncated TLV'); b=bytes[i++]; length=length*128+(b&127); }while(b&128);
    if(i+length>bytes.length) throw Error('Truncated TLV value');
    out[tag]=Array.from(bytes.slice(i,i+length));i+=length;
  }
  return out;
}
function encrypt(body) {
  const ivBuffer=Memory.alloc(16);if(random(ptr(0),16,ivBuffer)!==0)throw Error('Random generator failed');
  const iv=new Uint8Array(ivBuffer.readByteArray(16));
  const counterField=field(session,'ivSequence');
  let counter=(counterField.readU32()+1)>>>0;if(counter<=1)counter=1;counterField.writeU32(counter);
  new DataView(iv.buffer).setUint32(12,counter,false);
  const cipher=gcm(key(),iv).encrypt(new Uint8Array(body));
  return [...tlv(124,[1]),...tlv(125,iv),...tlv(126,cipher)];
}
function crc(bytes) {
  let c=0;
  for(const b of bytes) { c^=b<<8;for(let j=0;j<8;j++)c=((c&32768)?(c<<1)^0x1021:c<<1)&65535; }
  return c;
}
function finish(bytes) {const c=crc(bytes);return [...bytes,c>>8,c&255];}
function frames(sid,cid,body) {
  if(body.length+8<=frameLimit) return [finish([90,(body.length+3)>>8,(body.length+3)&255,0,sid,cid,...body])];
  const out=[];let offset=0,seq=0;
  while(offset<body.length) {
    const first=seq===0, capacity=frameLimit-7-(first?2:0), count=Math.min(capacity,body.length-offset);
    const last=offset+count===body.length,flag=first?1:last?3:2;
    const length=count+2+(first?2:0);
    out.push(finish([90,length>>8,length&255,flag,seq&255,...(first?[sid,cid]:[]),...body.slice(offset,offset+count)]));
    offset+=count;seq++;
  }
  return out;
}
let messageTail=Promise.resolve(),queuedMessages=0;
function writeBody(body) {
  if(!reserved)return Promise.reject(Error('P2P relay not reserved'));
  if(queuedMessages>=24)return Promise.reject(Error('P2P reply backpressure budget exceeded'));
  queuedMessages++;
  // Huawei fragment sequence numbers restart at zero for EACH message. ACKs
  // and commands must never insert their fragments into another message.
  const result=messageTail.then(async()=>{
    const batches=await onMain(()=>{valid();return frames(52,1,encrypt(body));});
    for(const bytes of batches)await new Promise((resolve,reject)=>{pendingWrites.push({bytes,resolve,reject});drain();});
  });
  messageTail=result.catch(()=>{});
  return result.finally(()=>{queuedMessages--;});
}
function packet(sid,cid,body) {
  const endpoint=sid.toString(16)+'/'+cid.toString(16);
  diagnostics.packetTypes[endpoint]=(diagnostics.packetTypes[endpoint]||0)+1;
  wireEvent({event:'packet',sid,cid,length:body.length});
  if(sid!==52 || cid!==1 || !reserved || !expectedFingerprint)return;
  try {
    const envelope=parseTLV(body);
    if(envelope[124]?.[0]===1)body=Array.from(gcm(key(),new Uint8Array(envelope[125])).decrypt(new Uint8Array(envelope[126])));
    diagnostics.p2pPackets++;
    const fields=parse(body),source=fields[3]?ascii(fields[3]):'',destination=fields[4]?ascii(fields[4]):'';
    if(source===WATCH_PACKAGE || destination===WATCH_PACKAGE){
      const code=fields[8]?fields[8].reduce((a,b)=>a*256+b,0):null;
      diagnostics.lastHeaders.push({kind:fields[1]?.[0],source,destination,code});
      if(diagnostics.lastHeaders.length>8)diagnostics.lastHeaders.shift();
      if(fields[1]?.[0]===3 && source===WATCH_PACKAGE && destination===PHONE_PACKAGE)
        send({kind:'p2p-ack',sequence:fields[2]?.reduce((a,b)=>a*256+b,0),code});
    }
    if(fields[1]?.[0]===1 && source===WATCH_PACKAGE){
      const pointer=decodePointerRoute(destination);
      if(pointer){
        diagnostics.routeMatches++;lastRoute={peerPackage:PHONE_PACKAGE,sourceFingerprint:bytes(expectedFingerprint)};
        send({kind:'pointer',payload:pointer});
        writeBody(ack({kind:1,sequence:fields[2],peerPackage:destination})).then(()=>{diagnostics.ackSent++;}).catch(e=>{diagnostics.ackFailed++;send({kind:'protocol-error',message:String(e)});});
        return;
      }
    }
    const m=decode(body,expectedFingerprint);if(!m)return;
    diagnostics.routeMatches++;
    if(m.diagnostic)send({kind:'watch-log-part',payload:m.diagnostic});
    if(m.managed)send({kind:'managed-part',payload:m.managed});
    if(m.payload){lastRoute=m;send({kind:m.payload.t==='pointer'?'pointer':'application-probe',payload:m.payload});}
    writeBody(ack(m)).then(()=>{diagnostics.ackSent++;}).catch(e=>{diagnostics.ackFailed++;send({kind:'protocol-error',message:String(e)});});
  }catch(e){send({kind:'protocol-error',message:String(e)});}
}
function feed(bytes) {
  receiving.push(...bytes);
  while(receiving.length>=5) {
    if(receiving[0]!==90){receiving=[];throw Error('Invalid frame magic');}
    const size=((receiving[1]<<8)|receiving[2])+5;
    if(size>65540){receiving=[];throw Error('Invalid frame length');}
    if(receiving.length<size)return;
    const f=receiving.splice(0,size);
    if(crc(f.slice(0,-2))!==((f.at(-2)<<8)|f.at(-1)))throw Error('Invalid frame CRC');
    diagnostics.wireFrames++;diagnostics.frameFlags[f[3]]=(diagnostics.frameFlags[f[3]]||0)+1;
    wireEvent({event:'frame',flag:f[3],length:size,sequence:f[3]===0?null:f[4]});
    const flag=f[3]&3;
    if(f[3]===0)packet(f[4],f[5],f.slice(6,-2));
    else if(flag===1){sliceSID=f[5];sliceCID=f[6];slices=f.slice(7,-2);nextSlice=1;}
    else if([2,3].includes(flag)) {
      if(f[4]!==nextSlice){slices=[];nextSlice=undefined;continue;}
      nextSlice=(nextSlice+1)&255;slices.push(...f.slice(5,-2));
      if(flag===3){packet(sliceSID,sliceCID,slices);slices=[];nextSlice=undefined;}
    }
  }
}
const hooks=[];
hooks.push(Interceptor.attach(owner['- peripheral:didUpdateValueForCharacteristic:error:'].implementation,{
  onEnter(args) {
    if(!args[0].equals(owner.handle)||!args[4].isNull())return;
    try {const c=new ObjC.Object(args[3]);const uuid=String(c.UUID().UUIDString());
      const value=c.value();if(!value)return;const n=Number(value.length());if(n>65536)return;
      diagnostics.notificationTypes[uuid]=(diagnostics.notificationTypes[uuid]||0)+1;
      if(uuid!=='FE02'){wireEvent({event:'other-notification',uuid,length:n});return;}
      feed(Array.from(new Uint8Array(value.bytes().readByteArray(n))));
    }catch(e){send({kind:'protocol-error',message:String(e)});}
  }
}));
function drain() {
  if(activeWrite || pendingWrites.length===0)return;
  const item=pendingWrites.shift();activeWrite=item;
  ObjC.schedule(ObjC.mainQueue,()=>{
    try {
      valid();if(!reserved)throw Error('No reserved transport');
      if(writeType===1&&!peripheral.canSendWriteWithoutResponse()){activeWrite=null;pendingWrites.unshift(item);setTimeout(drain,15);return;}
      const bytes=Memory.alloc(item.bytes.length);bytes.writeByteArray(item.bytes);
      const data=ObjC.classes.NSData.dataWithBytes_length_(bytes,item.bytes.length);
      peripheral.writeValue_forCharacteristic_type_(data,writer,writeType);
      if(writeType===1){activeWrite=null;item.resolve();setTimeout(drain,5);}
    }catch(e){activeWrite=null;item.reject(e);}
  });
}
hooks.push(Interceptor.attach(owner['- peripheral:didWriteValueForCharacteristic:error:'].implementation,{
  onEnter(args) {
    if(!args[0].equals(owner.handle)||!args[3].equals(writer.handle)||!activeWrite)return;
    const item=activeWrite;activeWrite=null;
    if(args[4].isNull())item.resolve();else item.reject(Error(String(new ObjC.Object(args[4]))));
    setImmediate(drain);
  }
}));
rpc.exports={
  info() { valid();return {paired:true,ready:true,busy:field(owner,'busy').readU8()!==0,frameLimit,writeType}; },
  stats(){return {...diagnostics,connection:{sameGeneration:connectionSlots.generation.readU64().toString()===generation,paired:connectionSlots.ownerPaired.readU8()===1,ready:connectionSlots.ready.readU8()===1}};},
  async probeData(){
    const sequence=nextSequence();return writeBody([].concat(p2ptlv(1,[2]),p2ptlv(2,[sequence>>8,sequence&255]),p2ptlv(3,bytes(PHONE_PACKAGE)),p2ptlv(4,bytes(WATCH_PACKAGE)),p2ptlv(5,bytes(PHONE_FINGERPRINT)),p2ptlv(6,bytes(expectedFingerprint)),p2ptlv(7,bytes('{"v":1,"t":"probe"}'))));
  },
  async ping(healthCompatibility=false){
    // Gadgetbridge HuaweiBaseP2PService uses this routing name for ping only.
    // Data messages retain our own application identity and certificate binding.
    const source=healthCompatibility===true?'com.huawei.health':PHONE_PACKAGE;
    const sequence=nextSequence();await writeBody([].concat(p2ptlv(1,[1]),p2ptlv(2,[sequence>>8,sequence&255]),p2ptlv(3,bytes(source)),p2ptlv(4,bytes(WATCH_PACKAGE))));return {sequence};
  },
  async command(value){
    const allowed=['hello','status','calibrate','arm','pause','mode','gain','button','pointer','probe','logs','exit','heartbeat','test'];
    if(!value || value.v!==1 || value.t!=='command' || allowed.indexOf(value.op)<0 || !/^[0-9a-f]{16}$/.test(value.session) || !Number.isSafeInteger(value.id) || value.id<1 || value.id>2147483647 || !(value.ttl>0 && value.ttl<=15000))throw Error('Invalid management command');
    const text=JSON.stringify(value);if(text.length>900)throw Error('Command budget exceeded');
    const sequence=nextSequence();
    await writeBody([].concat(p2ptlv(1,[2]),p2ptlv(2,[sequence>>8,sequence&255]),p2ptlv(3,bytes(PHONE_PACKAGE)),p2ptlv(4,bytes(WATCH_PACKAGE)),p2ptlv(5,bytes(PHONE_FINGERPRINT)),p2ptlv(6,bytes(expectedFingerprint)),p2ptlv(7,bytes(text))));
    return {sequence};
  },
  configure(fingerprint,enabled) {
    if(!fingerprint.startsWith(WATCH_PACKAGE+'_') || fingerprint.length>512)throw Error('Expected exact appverify application identity');
    expectedFingerprint=fingerprint;desktopEnabled=!!enabled;return true;
  },
  async status() {
    if(!lastRoute)return false;
    nextSequence();
    await writeBody(status(lastRoute,statusSequence,desktopEnabled));return true;
  },
  reserve() {return onMain(()=>{valid();if(reserved)return true;
    if(field(owner,'busy').readU8()!==0||field(owner,'writing').readU8()!==0)throw Error('Existing app transport is busy');
    const app=ObjC.classes.UIApplication.sharedApplication();
    previousIdleTimer=Boolean(app.isIdleTimerDisabled());app.setIdleTimerDisabled_(true);
    field(owner,'busy').writeU8(1);reserved=true;return true;});},
  release(){return onMain(()=>{
    if(reserved && field(owner,'generation').readU64().toString()===generation)field(owner,'busy').writeU8(0);
    if(previousIdleTimer!==null)ObjC.classes.UIApplication.sharedApplication().setIdleTimerDisabled_(previousIdleTimer);
    reserved=false;previousIdleTimer=null;return true;
  });}
};
// Push observations; a polling RPC must never contend with a BLE delegate hook.
setInterval(()=>{send({kind:'wire-stats',payload:{p2pPackets:diagnostics.p2pPackets,routeMatches:diagnostics.routeMatches,ackSent:diagnostics.ackSent,ackFailed:diagnostics.ackFailed,
  wireFrames:diagnostics.wireFrames,frameFlags:diagnostics.frameFlags,packetTypes:diagnostics.packetTypes,wireTail:diagnostics.wireTail,notificationTypes:diagnostics.notificationTypes,
  connection:{sameGeneration:connectionSlots.generation.readU64().toString()===generation,paired:connectionSlots.ownerPaired.readU8()===1,ready:connectionSlots.ready.readU8()===1}}});},1000);
send({kind:'ready',...rpc.exports.info()});
