import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { sourceModule } from './load-source.mjs';
const {default: Motion}=await sourceModule(new URL('../watch/entry/src/main/js/default/common/motion.js',import.meta.url));
const {default:Controller}=await sourceModule(new URL('../watch/entry/src/main/js/default/common/managed-controller.js',import.meta.url));
let time=1000,tick,accel,gyro,stopped=0,keep=[],unsubs=0,frames=[],lateScreenCallback;
const config={frameMs:50,interval:'game'};
const source=fs.readFileSync(new URL('../watch/entry/src/main/js/default/pages/control/control.js',import.meta.url),'utf8')
 .replace(/^import .*;$/mg,'').replace('export default {','globalThis.page = {');
const context=vm.createContext({Motion,Controller,config,managed:{stop:()=>{},start:()=>{},emit:()=>{},idle:()=>true},diagnosticLog:{add:()=>{}},application:{terminate:()=>{}},Date:{now:()=>time},
 sensor:{subscribeAccelerometer:o=>{accel=o.success},subscribeGyroscope:o=>{gyro=o.success},unsubscribeAccelerometer:()=>unsubs++,unsubscribeGyroscope:()=>unsubs++},
 brightness:{setKeepScreenOn:o=>{keep.push(o.keepScreenOn);if(o.success)lateScreenCallback=o.success}},
 bridge:{send:f=>frames.push(f),stop:()=>stopped++,start:()=>{}},
 setInterval:fn=>{tick=fn;return 1},clearInterval:()=>{tick=null},clearTimeout:()=>{},console});
vm.runInContext(source,context);
const page=context.page;Object.assign(page,page.data);page.onInit();page.onShow();page.calibrate();vm.runInContext('pointerEnabled=true;controller.lease=10000;',context);
for(time=1000;time<=1800;time+=20){accel({x:0,y:0,z:9.81});gyro({x:0,y:0,z:0});tick();}
assert.equal(page.calibration,'Ready');page.toggle();page.left();tick();
assert.ok(frames.some(f=>f.armed && f.buttons.length===1));
page.onHide();assert.equal(unsubs,2);assert.ok(stopped>=1);assert.equal(frames.at(-1).armed,false);
assert.equal(keep.at(-1),false);assert.equal(tick,null);
lateScreenCallback();assert.equal(keep.at(-1),false);
page.onShow();tick();assert.equal(frames.at(-1).armed,false);page.onDestroy();
console.log('Lifecycle tests passed: native callbacks, calibration, pause on hide, sensor unsubscribe, late brightness completion and paused resume');
