import assert from 'node:assert/strict';
import {decodePointerRoute} from '../relay/pointer-beacon.js';
import {PHONE_PACKAGE} from '../relay/protocol.js';
const prefix=PHONE_PACKAGE+'.gt4ptr.x';
function fixture(overrides={}) {
    const f={version:1,flags:1,hi:281474976710655,lo:4294967295,seq:4294967295,sent:1730000000123,dx:-12.34,dy:56.78,scroll:-0.01,buttons:[],...overrides};
    const out=[];
    function uint(value,size){const b=Array(size);for(let i=size-1;i>=0;i--){b[i]=value%256;value=Math.floor(value/256);}out.push(...b);}
    function fixed(value){uint(Math.round(value*100)&65535,2);}
    uint(f.version,1);uint(f.flags,1);uint(f.hi,6);uint(f.lo,4);uint(f.seq,4);uint(f.sent,6);
    fixed(f.dx);fixed(f.dy);fixed(f.scroll);uint(f.buttons.length,1);
    for(const b of f.buttons){uint(b.kind,1);uint(b.id,2);uint(b.age,2);}
    return prefix+out.map(b=>b.toString(16).padStart(2,'0')).join('');
}
const route=fixture(),frame=decodePointerRoute(route);
assert.equal(route.length-prefix.length,58);
assert.deepEqual(frame,{v:1,t:'pointer',session:'281474976710655-4294967295',seq:4294967295,sent:1730000000123,armed:true,dx:-12.34,dy:56.78,scroll:-0.01,buttons:[],origin:'real-sensor',backend:'experimental-ping'});
assert.match(frame.session,/^[0-9]+-[0-9]+$/);
const buttons=[{kind:1,id:1,age:0},{kind:2,id:65535,age:65535},{kind:3,id:2,age:350}];
const maximum=fixture({flags:3,dx:-100,dy:100,scroll:-60,buttons});
assert.equal(maximum.length-prefix.length,88);
assert.equal(decodePointerRoute(maximum).origin,'synthetic-watch-test');
assert.deepEqual(decodePointerRoute(maximum).buttons,[{kind:'left',id:1,age:0},{kind:'right',id:65535,age:65535},{kind:'double',id:2,age:350}]);
assert.equal(decodePointerRoute(fixture({flags:2,scroll:60,buttons:[{kind:4,id:4,age:1}]})).buttons[0].kind,'drag');
assert.equal(decodePointerRoute(fixture({flags:0,seq:1,hi:0,lo:0,sent:0})).armed,false);
for(const bad of [{version:2},{flags:4},{seq:0},{dx:100.01},{dy:-100.01},{scroll:60.01},{scroll:-60.01},{buttons:[{kind:0,id:1,age:0}]},{buttons:[{kind:5,id:1,age:0}]},{buttons:[{kind:1,id:0,age:0}]},{buttons:Array(4).fill({kind:1,id:1,age:0})}])assert.throws(()=>decodePointerRoute(fixture(bad)));
for(const bad of [route+'00',route.slice(0,-2),route.slice(0,-1),prefix+'ff'.repeat(45),prefix+'g'.repeat(58),prefix+route.slice(prefix.length).toUpperCase(),maximum.slice(0,-2)])assert.throws(()=>decodePointerRoute(bad));
for(const normal of [null,42,'',PHONE_PACKAGE,PHONE_PACKAGE+'.gt4log.s12345678.p1n1.x7b',PHONE_PACKAGE+'.gt4rpc.s12345678.p1n1.x7b',PHONE_PACKAGE+'.probe',PHONE_PACKAGE+'.gt4ptr.X01','other.gt4ptr.x'+route.slice(prefix.length)])assert.equal(decodePointerRoute(normal),null);
console.log('pointer beacon codec tests passed');
