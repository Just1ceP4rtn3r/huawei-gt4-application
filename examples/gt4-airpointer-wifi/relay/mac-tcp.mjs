// Mac owns both TCP sockets and all P2P crypto. Session key is stdin-only, memory-only.
import net from 'node:net';
import {sealFrame,unsealFrame} from './mac-crypto.mjs';
import readline from 'node:readline';
import {encode,decoder} from './tcp-channel.js';
import {parse,decode,ack,status,ascii,bytes,tlv,WATCH_PACKAGE,PHONE_PACKAGE,PHONE_FINGERPRINT} from './protocol.js';
import {decodePointerRoute} from './pointer-beacon.js';
let key=null,identity=null,enabled=false,peers=[],sequence=1000,lastRoute=null,tail=Promise.resolve();
let received=0,matched=0,acks=0,failed=0;
const emit=(kind,payload)=>process.stdout.write(JSON.stringify({event:{kind,payload}})+'\n');
const next=()=>sequence=sequence%32766+1;
function write(body){const result=tail.then(()=>new Promise((resolve,reject)=>{const s=peers[1];if(!s||s.destroyed)return reject(Error('TCP closed'));s.write(Buffer.from(encode(52,1,sealFrame(key,body))),e=>e?reject(e):resolve());}));tail=result.catch(()=>{});return result;}
function packet(sid,cid,body){if(sid!==52||cid!==1)return;received++;
 try{const plain=unsealFrame(key,body),f=parse(plain);if(f[1]?.[0]===3){emit('p2p-ack',{sequence:f[2]?.reduce((a,b)=>a*256+b,0),code:f[8]?.reduce((a,b)=>a*256+b,0)});return;}
 const source=f[3]?ascii(f[3]):'',destination=f[4]?ascii(f[4]):'';
 const pointer=f[1]?.[0]===1&&source===WATCH_PACKAGE?decodePointerRoute(destination):null;
 const m=pointer?{kind:1,sequence:f[2],peerPackage:destination}:decode(plain,identity);if(!m)return;matched++;
 if(pointer)emit('pointer',pointer);if(m.managed)emit('managed-part',m.managed);if(m.diagnostic)emit('watch-log-part',m.diagnostic);
 if(m.payload)emit(m.payload.t==='pointer'?'pointer':'application-probe',m.payload);
 lastRoute={peerPackage:PHONE_PACKAGE,sourceFingerprint:bytes(identity)};
 write(ack(m)).then(()=>acks++).catch(()=>{failed++;emit('protocol-error',{reason:'ACK write failed'});});
 }catch{emit('protocol-error',{reason:'Frame authentication or validation failed'});}
}
async function close(){for(const s of peers)s.destroy();peers=[];}
const rpc={
 init(value){if(key||![16,24,32].includes(value.length))throw Error('Invalid session initialization');key=Buffer.from(value);return true;},
 configure(value,on){if(!value.startsWith(WATCH_PACKAGE+'_'))throw Error('Invalid app identity');identity=value;enabled=!!on;return true;},
 reserve(){return true;},
 async transport(mode){if(mode!=='tcp')throw Error('TCP only');await close();try{for(const port of [2000,2001]){const s=await new Promise((resolve,reject)=>{const socket=net.createConnection({host:'192.168.1.1',port});const timer=setTimeout(()=>{socket.destroy();reject(Error('TCP deadline'));},5000);socket.once('connect',()=>{clearTimeout(timer);resolve(socket)});socket.once('error',e=>{clearTimeout(timer);const failure=Error('TCP connection failed');failure.code=e.code;failure.port=port;reject(failure)});});peers.push(s);const feed=decoder(packet);s.on('data',data=>{try{feed([...data]);}catch{emit('tcp-state',{state:'lost',reason:'Invalid framing'});close();}});s.on('error',()=>{});s.on('close',()=>{emit('tcp-state',{state:'lost'});close();});}emit('tcp-state',{state:'connected',owner:'mac'});return {transport:'mac-direct-tcp'};}catch(e){await close();throw e;}},
 async ping(){const n=next();await write([...tlv(1,[1]),...tlv(2,[n>>8,n&255]),...tlv(3,bytes(PHONE_PACKAGE)),...tlv(4,bytes(WATCH_PACKAGE))]);return {sequence:n};},
 async command(v){if(!v||v.v!==1||v.t!=='command'||!['hello','status','calibrate','arm','pause','mode','gain','button','pointer','probe','logs','exit','heartbeat','test'].includes(v.op)||!/^[0-9a-f]{16}$/.test(v.session)||!Number.isSafeInteger(v.id)||v.id<1||v.id>2147483647||!(v.ttl>0&&v.ttl<=15000)||JSON.stringify(v).length>900)throw Error('Invalid command');const n=next();await write([...tlv(1,[2]),...tlv(2,[n>>8,n&255]),...tlv(3,bytes(PHONE_PACKAGE)),...tlv(4,bytes(WATCH_PACKAGE)),...tlv(5,bytes(PHONE_FINGERPRINT)),...tlv(6,bytes(identity)),...tlv(7,bytes(JSON.stringify(v)))]);return {sequence:n};},
 async status(){if(!lastRoute)return false;await write(status(lastRoute,next(),enabled));return true;},
 stats(){return {p2pPackets:received,routeMatches:matched,ackSent:acks,ackFailed:failed,connection:{sameGeneration:true,paired:true,ready:peers.length===2&&peers.every(s=>!s.destroyed)}};},
 async release(){await close();key?.fill(0);key=null;return true;}
};
const interval=setInterval(()=>emit('wire-stats',rpc.stats()),1000);
const input=readline.createInterface({input:process.stdin});let serial=Promise.resolve();
input.on('line',line=>{serial=serial.then(async()=>{let id;try{const r=JSON.parse(line);id=r.id;if(!Object.hasOwn(rpc,r.method))throw Error('Unknown method');const result=await rpc[r.method](...r.args);process.stdout.write(JSON.stringify({id,ok:true,result})+'\n');}catch(e){process.stdout.write(JSON.stringify({id,ok:false,error:'Mac transport operation failed',code:typeof e.code==='string'&&/^[A-Z0-9_]+$/.test(e.code)?e.code:null,port:[2000,2001].includes(e.port)?e.port:null})+'\n');}});});
input.on('close',async()=>{clearInterval(interval);await rpc.release();process.exit(0);});
