// Local, memory-only adapter for the user's already paired CrescentRelay session.
// Protocol framing follows Gadgetbridge / HuaSideload (AGPL-3.0); see docs/SOURCES.md.
import ObjC from '../tools/frida-agent/node_modules/frida-objc-bridge/index.js';
import { gcm, cbc } from '../tools/frida-agent/node_modules/@noble/ciphers/aes.js';

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
let reserved = false, previousIdleTimer = null, receiving = [], slices = [], sliceSID, sliceCID, nextSlice;
let pendingWrites = [], activeWrite = null;
const writeType = Number(writer.properties()) & 8 ? 0 : 1;
const frameLimit = Math.min(182, Number(peripheral.maximumWriteValueLengthForType_(writeType)));
function onMain(fn) { return new Promise((resolve, reject) => ObjC.schedule(ObjC.mainQueue, () => { try { resolve(fn()); } catch(e) { reject(e); } })); }
function valid() {
  if (field(owner, 'generation').readU64().toString() !== generation ||
      field(owner, 'isPaired').readU8() !== 1 || field(session, 'isPaired').readU8() !== 1 ||
      field(owner, 'channelReady').readU8() !== 1 || Number(peripheral.state()) !== 2) throw Error('Paired connection changed');
}
function key() {
  valid();
  const buffer = field(session, 'sessionKey').readPointer();
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
function packet(sid,cid,body) {
  if(![40,42].includes(sid))return;
  try {
    const envelope=parseTLV(body);
    if(envelope[124]?.[0]===1)body=Array.from(gcm(key(),new Uint8Array(envelope[125])).decrypt(new Uint8Array(envelope[126])));
    send({kind:'packet',sid,cid,body});
  } catch(e) { send({kind:'protocol-error',message:String(e),sid,cid}); }
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
    try {const c=new ObjC.Object(args[3]);if(String(c.UUID().UUIDString())!=='FE02')return;
      const value=c.value();if(!value)return;const n=Number(value.length());if(n>65536)return;
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
  info() { valid();return {name:String(peripheral.name()),paired:true,ready:true,busy:field(owner,'busy').readU8()!==0,frameLimit,writeType}; },
  authenticationIdentity() {
    valid();
    const storage=field(session,'watchUDID');
    const size=Number(storage.readU64().and(uint64('0x0000ffffffffffff')));
    if(size!==64)throw Error('Unexpected authentication identity string layout');
    const address=storage.add(8).readPointer().and(ptr('0x0fffffffffffffff')).add(32);
    const identity=address.readUtf8String(64);
    if(!/^[A-Fa-f0-9]{64}$/.test(identity))throw Error('Invalid authentication identity');
    // Existing app's field is named watchUDID, but GT4 testing disproves that label.
    // Never use this value as the debugging UDID or overwrite watch-udid.txt.
    return identity;
  },
  reserve() {return onMain(()=>{valid();if(reserved)return true;
    if(field(owner,'busy').readU8()!==0||field(owner,'writing').readU8()!==0)throw Error('Existing app transport is busy');
    const app=ObjC.classes.UIApplication.sharedApplication();
    previousIdleTimer=Boolean(app.isIdleTimerDisabled());app.setIdleTimerDisabled_(true);
    field(owner,'busy').writeU8(1);reserved=true;return true;});},
  async write(sid,cid,body,plaintext=false) {
    if(!reserved)throw Error('Reserve the transport first');
    if(!(sid===42&&[3,6].includes(cid))&&!(sid===40&&[2,3,4,6,7].includes(cid)))throw Error('Endpoint not allowed');
    if(plaintext && !(sid===40&&cid===6))throw Error('Plaintext limited to negotiated file-data units');
    if(body.length>48000)throw Error('Payload too large');
    const batches=await onMain(()=>{valid();return frames(sid,cid,plaintext?body:encrypt(body));});
    for(const bytes of batches)await new Promise((resolve,reject)=>{pendingWrites.push({bytes,resolve,reject});drain();});
    return batches.length;
  },
  release(){return onMain(()=>{
    if(reserved && field(owner,'generation').readU64().toString()===generation)field(owner,'busy').writeU8(0);
    if(previousIdleTimer!==null)ObjC.classes.UIApplication.sharedApplication().setIdleTimerDisabled_(previousIdleTimer);
    reserved=false;previousIdleTimer=null;return true;
  });}
};
send({kind:'ready',...rpc.exports.info()});
