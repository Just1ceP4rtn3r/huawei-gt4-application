import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline';
const child=spawn(process.execPath,[fileURLToPath(new URL('../relay/mac-tcp.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe']});
const pending=new Map();let n=0;
readline.createInterface({input:child.stdout}).on('line',line=>{const v=JSON.parse(line);if(v.id)pending.get(v.id)?.(v)});
function rpc(method,...args){return new Promise((resolve,reject)=>{const id=++n,t=setTimeout(()=>reject(Error('RPC deadline')),3000);pending.set(id,v=>{clearTimeout(t);pending.delete(id);resolve(v)});child.stdin.write(JSON.stringify({id,method,args})+'\n')})}
try{
 assert.equal((await rpc('init',Array(16).fill(42))).ok,true);
 assert.equal((await rpc('configure','com.example.gt4counter_test',false)).ok,true);
 assert.equal((await rpc('reserve')).ok,true);
 assert.equal((await rpc('stats')).result.connection.ready,false);
 assert.equal((await rpc('command',{op:'arm'})).ok,false);
 assert.equal((await rpc('init',Array(16).fill(42))).ok,false);
 assert.equal((await rpc('release')).ok,true);
 console.log('Mac RPC startup, state, invalid-command rejection and release passed (offline)');
}finally{child.stdin.end();}
