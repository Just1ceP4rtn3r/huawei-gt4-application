// OFFLINE only: execute production frame/message functions with a controlled BLE writer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../relay/iphone-agent.js',import.meta.url),'utf8');
const start=source.indexOf('function crc(bytes) {');
const end=source.indexOf('\nfunction packet(',start);
assert(start>=0 && end>start,'Production frame/writeBody function boundaries missing');
const implementation=source.slice(start,end);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
    let active=null;
    const written=[],pendingWrites=[];
    const context=vm.createContext({Promise,Error,Math,Uint8Array,frameLimit:182,reserved:true,pendingWrites,
        valid(){},encrypt(body){return body;},onMain(fn){return Promise.resolve().then(fn);},
        drain(){
            if(active || !pendingWrites.length)return;
            active=pendingWrites.shift();written.push(Array.from(active.bytes));
        }});
    vm.runInContext(implementation,context);
    return {context,written,
        async waitActive(){for(let i=0;i<100;i++){if(active)return;await tick();}throw Error('No queued BLE write');},
        complete(fail=false){assert(active,'Expected an in-flight write');const item=active;active=null;
            if(fail)item.reject(Error('injected BLE failure'));else item.resolve();},
        async pump(promises,failFirst=false){
            let remaining=promises.length;
            const settled=promises.map(p=>p.then(()=>({ok:true}),error=>({ok:false,error:String(error)})).finally(()=>remaining--));
            for(let step=0;remaining && step<200;step++){
                await tick();if(active){this.complete(failFirst);failFirst=false;}
            }
            assert.equal(remaining,0,'Message queue did not settle within bounded writer steps');
            assert.equal(pendingWrites.length,0);assert.equal(active,null);
            assert.equal(vm.runInContext('queuedMessages',context),0);
            return Promise.all(settled);
        }};
}
// Independent strict wire consumer: overlapping starts are an error, not silently accepted.
function reassemble(frames,crc){
    const messages=[];let body=null,next=0;
    for(const frame of frames){
        assert.equal(frame[0],90);assert.equal(((frame[1]<<8)|frame[2])+5,frame.length);
        assert.equal(crc(frame.slice(0,-2)),(frame.at(-2)<<8)|frame.at(-1));
        const flag=frame[3];
        if(flag===0){assert.equal(body,null,'A complete message interleaved with a fragmented message');assert.deepEqual(frame.slice(4,6),[52,1]);messages.push(frame.slice(6,-2));}
        else if(flag===1){assert.equal(body,null,'Fragmented message starts interleaved');assert.equal(frame[4],0);assert.deepEqual(frame.slice(5,7),[52,1]);body=frame.slice(7,-2);next=1;}
        else {assert(body,'Continuation without a message');assert([2,3].includes(flag));assert.equal(frame[4],next++);body.push(...frame.slice(5,-2));if(flag===3){messages.push(body);body=null;}}
    }
    assert.equal(body,null,'Unfinished message');return messages;
}
const A=Array.from({length:430},(_,i)=>i%251),B=Array.from({length:225},(_,i)=>(i+71)%251);
{
    const h=harness(),a=h.context.writeBody(A);
    await h.waitActive(); // Inject a competing ACK while the command's first fragment is in flight.
    const b=h.context.writeBody(B);
    const outcomes=await h.pump([a,b]);assert(outcomes.every(x=>x.ok));
    assert.deepEqual(h.written.map(f=>[f[3],f[4]]),[[1,0],[2,1],[3,2],[1,0],[3,1]]);
    assert.deepEqual(reassemble(h.written,h.context.crc),[A,B]);
}
{
    const h=harness(),a=h.context.writeBody(A);
    await h.waitActive();const b=h.context.writeBody(B);
    const outcomes=await h.pump([a,b],true);
    assert.equal(outcomes[0].ok,false);assert.match(outcomes[0].error,/injected BLE failure/);assert.equal(outcomes[1].ok,true);
    // A's rejected first write must not leak any further A fragments into B.
    assert.deepEqual(h.written.map(f=>[f[3],f[4]]),[[1,0],[1,0],[3,1]]);
    assert.deepEqual(reassemble(h.written.slice(1),h.context.crc),[B]);
}
{
    const h=harness(),a=h.context.writeBody(A);
    await h.waitActive();const single=[1,2,3],b=h.context.writeBody(single);
    assert((await h.pump([a,b])).every(x=>x.ok));
    assert.deepEqual(reassemble(h.written,h.context.crc),[A,single]);
}
console.log('OFFLINE production message queue: intact reassembly, no interleaving, failure isolation passed');
