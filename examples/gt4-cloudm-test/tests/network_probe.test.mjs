// OFFLINE only: execute the actual probe source, with explicitly mocked native modules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../watch/entry/src/main/js/default/common/network-probe.js',import.meta.url),'utf8').replaceAll('export function ','function ');
function harness(modules={}){
    const loaded=[],timers=new Map(),delays=[];let serial=0;
    const context=vm.createContext({requireModule(name){loaded.push(name);const value=modules[name];if(value instanceof Error)throw value;return value;},
        setTimeout(fn,ms){assert([5000,6000].includes(ms));delays.push(ms);timers.set(++serial,fn);return serial;},clearTimeout(id){timers.delete(id);}});
    vm.runInContext(source,context);assert.equal(loaded.length,0,'Probe must not load native modules at initialization');
    return {context,loaded,timers,delays,run(args){let calls=[];context.probe(args,r=>calls.push(r));return calls;},timeout(){assert.equal(timers.size,1);const [id,fn]=[...timers][0];timers.delete(id);fn();}};
}
const names={socket:'@ohos.net.socket',http:'@ohos.net.http',websocket:'@ohos.net.webSocket',fetch:'@system.fetch',network:'@system.network'};
const methods={socket:['constructTCPSocketInstance','constructUDPSocketInstance'],http:['createHttp'],websocket:['createWebSocket'],fetch:['fetch'],network:['getType','subscribe','unsubscribe']};
{
    const modules={};for(const api in names){modules[names[api]]={};for(const method of methods[api])modules[names[api]][method]=function(){throw Error('Inspect must not call methods');};}
    const h=harness(modules);
    for(const api in names){const result=h.run({api})[0];assert.equal(result.ok,true);assert.equal(result.module,names[api]);assert.equal(result.action,'inspect');assert.equal(result.type,'object');for(const method of methods[api])assert.equal(result.methods[method],'function');}
    assert.deepEqual(h.loaded,Object.values(names));assert.equal(h.timers.size,0);
}
for(const absent of [undefined,null]){
    const h=harness({'@ohos.net.socket':absent}),calls=h.run({api:'socket'});
    assert.equal(calls.length,1);assert.equal(calls[0].ok,false);assert.equal(calls[0].methods.constructTCPSocketInstance,'undefined');
}
{
    const h=harness({'@ohos.net.socket':new Error('mock module unavailable')});
    assert.match(h.run({api:'socket'})[0].error,/mock module unavailable/);
    assert.equal(h.run({api:'socket',action:'tcpConnect'})[0].ok,false);assert.equal(h.loaded.length,1);
    assert.equal(h.run({api:'wifi'})[0].ok,false);assert.equal(h.loaded.length,1);
}
{
    const h=harness({'@ohos.net.socket':{}}),result=h.run({api:'socket',action:'create'})[0];
    assert.equal(result.ok,false);assert.equal(result.items.length,2);assert.match(result.items[0].error,/Constructor unavailable/);assert.match(result.items[1].error,/Constructor unavailable/);
}
{
    const closed=[],modules={'@ohos.net.socket':{constructTCPSocketInstance(){return {close(cb){closed.push('tcp');cb();cb({message:'duplicate'});}};},constructUDPSocketInstance(){return {close(cb){closed.push('udp');cb();}};}}};
    const h=harness(modules),calls=h.run({api:'socket',action:'create'});
    assert.equal(calls.length,1);assert.equal(calls[0].ok,true);assert.deepEqual(closed,['tcp','udp']);assert.equal(h.timers.size,0);
    for(const item of calls[0].items){assert.equal(item.created,true);assert.equal(item.closed,true);}
}
{
    const h=harness({'@ohos.net.socket':{constructTCPSocketInstance(){throw {message:'mock denied',code:201};}}});
    const result=h.run({api:'socket',action:'create',kind:'tcp'})[0];assert.equal(result.ok,false);assert.equal(result.items[0].code,'201');assert.equal(h.timers.size,0);
}
{
    const h=harness({'@ohos.net.socket':{constructTCPSocketInstance(){return {};}}});
    const result=h.run({api:'socket',action:'create',kind:'tcp'})[0];assert.equal(result.ok,false);assert.match(result.items[0].error,/Close unavailable/);
}
{
    let complete;const h=harness({'@ohos.net.socket':{constructTCPSocketInstance(){return {close(cb){complete=cb;}};}}});
    const calls=h.run({api:'socket',action:'create',kind:'tcp'});assert.equal(calls.length,0);
    assert.match(h.run({api:'socket'})[0].error,/busy/);
    h.timeout();assert.equal(calls.length,1);assert.equal(calls[0].ok,false);assert.match(calls[0].items[0].error,/5000ms/);
    complete();complete();assert.equal(calls.length,1,'Late/duplicate close callbacks must not finish twice');
    const canceled=h.run({api:'socket',action:'create',kind:'tcp'});const late=complete;
    h.context.cancel();assert.equal(h.timers.size,0);late();assert.equal(canceled.length,0,'Canceled callback must remain suppressed');
    assert.equal(h.run({api:'socket'})[0].ok,true,'Cancel releases busy state');
}
{
    const h=harness({'@ohos.net.socket':{constructTCPSocketInstance(){return {close(){return Promise.resolve();}};}}});
    const calls=h.run({api:'socket',action:'create',kind:'tcp'});await Promise.resolve();await Promise.resolve();assert.equal(calls.length,1);assert.equal(calls[0].ok,true);assert.equal(h.timers.size,0);
}
// No host networking APIs are exposed to the VM: fetch is always this explicit mock.
const nonce='0123456789abcdef0123456789abcdef';
const request={api:'fetch',action:'request',nonce};
function fetchHarness(){
    const requests=[];
    const h=harness({'@system.fetch':{fetch(options){requests.push(options);}}});
    return {...h,requests};
}
{
    const h=fetchHarness(),calls=h.run({...request,url:'https://untrusted.invalid/ignored'});
    assert.equal(h.requests.length,1);assert.deepEqual(h.delays,[6000]);
    const options=h.requests[0];assert.equal(options.method,'GET');assert.equal(options.responseType,'text');
    assert.equal(options.url,'http://192.168.5.22:18765/gt4-probe/'+nonce,'Caller cannot redirect the controlled endpoint');
    options.success({code:200,data:'GT4-NET-'+nonce});
    assert.equal(calls.length,1);assert.equal(calls[0].ok,true);assert.equal(calls[0].echoMatch,true);assert.equal(calls[0].code,200);assert.equal(h.timers.size,0);
    const frozen=JSON.stringify(calls[0]);
    options.success({code:500,data:'wrong'});options.fail('late failure',999);options.complete();
    assert.equal(calls.length,1);assert.equal(JSON.stringify(calls[0]),frozen,'Duplicate callbacks cannot mutate a completed result');
}
{
    const h=fetchHarness(),calls=h.run(request);h.requests[0].fail('mock unavailable',230);
    assert.equal(calls.length,1);assert.equal(calls[0].ok,false);assert.equal(calls[0].code,'230');assert.equal(calls[0].error,'mock unavailable');assert.equal(h.timers.size,0);
    h.requests[0].success({code:200,data:'GT4-NET-'+nonce});assert.equal(calls.length,1);assert.equal(calls[0].ok,false);
}
{
    const h=fetchHarness(),calls=h.run(request);h.timeout();
    assert.equal(calls.length,1);assert.equal(calls[0].ok,false);assert.match(calls[0].error,/6000ms/);
    h.requests[0].success({code:200,data:'GT4-NET-'+nonce});h.requests[0].complete();
    assert.equal(calls.length,1);assert.equal(calls[0].ok,false);
}
{
    const h=fetchHarness(),calls=h.run(request);h.requests[0].complete();h.requests[0].complete();
    assert.equal(calls.length,0,'complete-only must never be reported as a successful HTTP response');
    h.timeout();assert.equal(calls.length,1);assert.equal(calls[0].completedCallback,true);assert.equal(calls[0].ok,false);
}
for(const value of [{code:200,data:'GT4-NET-'+nonce.slice(0,-1)+'0'},{code:201,data:'GT4-NET-'+nonce},{code:200,data:{nonce}}]){
    const h=fetchHarness(),calls=h.run(request);h.requests[0].success(value);
    assert.equal(calls.length,1);assert.equal(calls[0].ok,false,'Exact text echo AND HTTP 200 are both required');
}
for(const invalid of ['',nonce.slice(1),nonce+'0',nonce.toUpperCase(),'z'.repeat(32)]){
    const h=fetchHarness(),calls=h.run({...request,nonce:invalid});
    assert.equal(calls.length,1);assert.equal(calls[0].ok,false);assert.match(calls[0].error,/nonce/);
    assert.equal(h.requests.length,0,'Invalid nonce must never invoke even the mocked fetch');assert.equal(h.timers.size,0);
}
{
    const h=fetchHarness(),calls=h.run(request),old=h.requests[0];h.context.cancel();
    assert.equal(h.timers.size,0);old.success({code:200,data:'GT4-NET-'+nonce});old.fail('late',1);old.complete();
    assert.equal(calls.length,0,'Canceled fetch cannot invoke the application callback');
    const fresh=h.run(request);old.success({code:200,data:'GT4-NET-'+nonce});assert.equal(fresh.length,0);
    h.requests[1].success({code:200,data:'GT4-NET-'+nonce});assert.equal(fresh.length,1);assert.equal(fresh[0].ok,true);
}
console.log('OFFLINE network probe: lazy modules, socket lifecycle and controlled fetch callbacks/nonce/cancellation passed');
