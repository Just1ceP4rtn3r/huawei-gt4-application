// Execute shipped webpack artifacts, not just source modules; catch unbundled Node requires and ESM/CommonJS mixing.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const base=new URL('../watch/build/loader_out_lite/js/default/',import.meta.url);
for(const relative of ['app.js','pages/index/index.js','pages/control/control.js']) {
  const nativeCalls=[];let view,intervalTick,receiver,failSend=false,wearEngineLoads=0;const timeouts=new Map();let timerID=0;
  const native={
    'system.wearengine':{getWearEngineVersion:o=>o.complete('3.0.401'),setPackageName:o=>{nativeCalls.push(['setPackageName']);o.complete()},setFingerprint:o=>{nativeCalls.push(['setFingerprint']);o.complete()},subscribeMsg:o=>{receiver=o;nativeCalls.push(['subscribeMsg']);o.success({isRegister:true})},detect:o=>{nativeCalls.push(['detect',o.bundleName]);o.success()},unsubscribeMsg:()=>{},sendMsg:o=>{nativeCalls.push(['sendMsg']);if(failSend)o.fail(undefined,987);else o.success()}},
    'system.app':{getInfo:()=>({versionName:'1.2.6'}),terminate:()=>nativeCalls.push(['terminate'])},
    'system.router':{replace:o=>nativeCalls.push(['route',o.uri])},
    'system.sensor':{subscribeAccelerometer:o=>nativeCalls.push(['accelerometer']),subscribeGyroscope:o=>nativeCalls.push(['gyroscope']),unsubscribeAccelerometer:()=>nativeCalls.push(['unsubscribeAccelerometer']),unsubscribeGyroscope:()=>nativeCalls.push(['unsubscribeGyroscope'])},
    'system.brightness':{setKeepScreenOn:o=>nativeCalls.push(['keepScreen',o.keepScreenOn])}
  };
  const context=vm.createContext({
    module:{exports:{}},
    require:name=>{throw Error('Unbundled computer-only require in watch artifact: '+name)},
    requireNative:name=>{if(!(name in native))throw Error('Unexpected native module '+name);if(name==='system.wearengine')wearEngineLoads++;return native[name]},
    ViewModel:function(options){assert.ok(options && typeof options==='object');Object.assign(this,options.data||{},options);view=this;},
    _c:(tag,attrs,children)=>({tag,attrs,children}),_i:(condition,render)=>condition()?render():null,
    setInterval:fn=>{intervalTick=fn;return 1},clearInterval:()=>{},setTimeout:fn=>{timeouts.set(++timerID,fn);return timerID},clearTimeout:id=>timeouts.delete(id),console
  });
  vm.runInContext(fs.readFileSync(new URL(relative,base),'utf8'),context,{filename:relative,timeout:1000});
  assert.ok(view,relative+' did not create ViewModel');
  if(view.onInit)view.onInit();
  if(view.render)assert.equal(view.render(view).tag,'div');
  function drain(){let guard=0;while(timeouts.size){assert.ok(++guard<300,'runaway watch timers');const [id,fn]=timeouts.entries().next().value;timeouts.delete(id);fn()}}
  if(relative.includes('/index/')){view.onShow();drain();assert.equal(nativeCalls[0][0],'route');view.onHide()}
  if(relative.includes('/control/')){
    assert.equal(wearEngineLoads,0,'WearEngine must not load before the control lifecycle');
    view.onShow();drain();assert.ok(nativeCalls.some(c=>c[0]==='accelerometer'));assert.ok(nativeCalls.some(c=>c[0]==='gyroscope'));
    assert.ok(nativeCalls.some(c=>c[0]==='setFingerprint'));assert.ok(nativeCalls.some(c=>c[0]==='subscribeMsg'));
    function messages(){const groups=new Map();for(const c of nativeCalls){if(c[0]!=='detect' || !c[1].includes('.gt4rpc.'))continue;const m=/\.gt4rpc\.s([a-f0-9]+)\.p(\d+)n(\d+)\.x([a-f0-9]+)$/.exec(c[1]);assert.ok(m);if(!groups.has(m[1]))groups.set(m[1],[]);groups.get(m[1])[+m[2]-1]=Buffer.from(m[4],'hex').toString()}return [...groups.values()].map(p=>JSON.parse(p.join('')))}
    assert.ok(messages().some(m=>m.event==='ready' && m.data.version==='1.2.6'));
    intervalTick();assert.equal(nativeCalls.filter(c=>c[0]==='sendMsg').length,0,'Startup must never send pointer input automatically');
    let id=0;function command(op,args={}){const n=++id;receiver.success({message:JSON.stringify({v:1,t:'command',session:'1234567890abcdef',id:n,op,args,ttl:15000})});drain();const ack=messages().find(m=>m.event==='ack' && m.id===n);assert.ok(ack,'Missing app ACK '+op);return ack.data}
    assert.equal(command('hello').ok,true);assert.equal(command('status').result.screen,'control');
    assert.equal(command('arm').ok,false);
    failSend=true;const probe=command('probe',{api:'wearengine'});assert.equal(probe.result.ok,false);assert.deepEqual(probe.result.args,['undefined',987]);
    command('test');const logs=command('logs');assert.deepEqual(logs.result.events.find(e=>e[2]==='sendMsg.fail')[3],['undefined',987]);
    assert.equal(view.render(view).tag,'div');
    for(const action of ['calibrate','toggle','left','right','drag','switchMode','speed'])assert.equal(typeof view[action],'function');
    view.onHide();assert.ok(nativeCalls.some(c=>c[0]==='unsubscribeGyroscope'));assert.equal(timeouts.size,0);
  }
}
console.log('Compiled Lite artifacts passed: automatic splash/control startup, managed ready/hello/status/probe/logs, no automatic mouse input, native error preservation and lifecycle cleanup');
