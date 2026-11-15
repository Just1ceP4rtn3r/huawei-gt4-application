// Offline protocol/privacy test; never opens Wi-Fi or connects to a device.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../relay/wifi-ap.js',import.meta.url),'utf8');
function tlv(t,v){let n=v.length,l=[n&127];while(n>>=7)l.unshift((n&127)|128);return [t,...l,...v];}
function parse(a){let i=0,o={};while(i<a.length){let t=a[i++],n=0,b;do{b=a[i++];n=n*128+(b&127);}while(b&128);o[t]=a.slice(i,i+n);i+=n;}return o;}
const bytes=s=>Array.from(Buffer.from(s));
const c=vm.createContext({JSON,Number,Array,Error,bytes,tlv});
vm.runInContext(source.replace(/^import .*;$/m,'').replace(/export function/g,'function'),c);
for(const action of [3,5]){
 const root=parse(c.apBody(action));assert.equal(Buffer.from(root[1]).toString(),'hw.uniedevice.wifiTransfer');assert.deepEqual(root[1],root[2]);
 const row=parse(parse(root[131])[132]);assert.equal(Buffer.from(row[5]).toString('hex'),'35a66fb3');assert.deepEqual(Array.from(row[6]),[action]);
 if(action===3)assert.deepEqual(JSON.parse(Buffer.from(row[7]).toString()),{EncryptedType:0,countrycode:'',authtype:2});else assert.equal(row[7],undefined);
}
assert.throws(()=>c.apBody(4));
const secret='DO-NOT-EXPORT';const data={ap_status:0,ssid:secret,password:secret,other:secret,socket_info:[{ip:'192.168.1.1',port:2000},{ip:'192.168.1.1',port:2001}]};
const fields={131:tlv(132,[...tlv(5,[53,166,111,179]),...tlv(6,[4]),...tlv(7,bytes(JSON.stringify(data)))])};
const s=JSON.parse(JSON.stringify(c.apSummary(fields,parse)));
assert.equal(JSON.stringify(s).includes(secret),false);assert.equal(s.rows[0].apStatus,0);assert.equal(s.rows[0].sockets[1].role,'command');assert.equal(s.rows[0].hasPassword,true);
console.log('OFFLINE AP wire actions/config ID and credential suppression passed');
