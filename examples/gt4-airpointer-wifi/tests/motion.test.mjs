import assert from 'node:assert/strict';
import { sourceModule } from './load-source.mjs';
const {default: Motion}=await sourceModule(new URL('../watch/entry/src/main/js/default/common/motion.js',import.meta.url));
function calibrated(options={}) {
  const m=new Motion(options);m.calibrate(1000);
  for(let t=1000;t<=1800;t+=20){m.accelerometer({x:0,y:0,z:9.81},t);m.gyroscope({x:0.012,y:-0.008,z:0.006},t);}
  assert.equal(m.ready,true);assert.equal(m.armed,false);return m;
}
{
  const m=calibrated();assert.ok(Math.abs(m.bias.x-0.012)<1e-8);m.setArmed(true);
  for(let t=1820;t<2300;t+=20){m.accelerometer({x:0,y:0,z:9.81},t);m.gyroscope({x:0.012,y:-0.008,z:0.006},t);}
  const f=m.frame(2300);assert.equal(f.dx,0);assert.equal(f.dy,0);
}
{
  const m=calibrated();m.setArmed(true);
  for(let t=1820;t<2100;t+=20)m.gyroscope({x:0.012,y:0,z:0.7},t);
  assert.ok(m.frame(2100).dx<0);m.setArmed(false);m.gyroscope({x:1,y:1,z:1},2120);
  assert.equal(m.frame(2120).dx,0);assert.equal(m.button('left',2120),false);
}
{
  const m=calibrated();m.setArmed(true);m.gyroscope({x:0,y:0,z:1},2000);m.gyroscope({x:0,y:0,z:1},2020);
  m.gyroscope({x:0,y:0,z:1},4000);assert.equal(m.frame(4000).dx,0);
  assert.equal(m.frame(4300).armed,false);
}
{
  const m=calibrated();m.setMode('scroll');assert.equal(m.armed,false);m.setArmed(true);
  for(let t=1820;t<2120;t+=20)m.gyroscope({x:0.7,y:0,z:0},t);
  const f=m.frame(2120);assert.equal(f.dx,0);assert.equal(f.dy,0);assert.notEqual(f.scroll,0);
}
{
  const m=new Motion();m.setGyroAvailable(false);m.calibrate(1000);
  for(let t=1000;t<=1800;t+=20)m.accelerometer({x:0,y:0,z:9.81},t);
  assert.equal(m.ready,true);m.setArmed(true);
  for(let t=1820;t<=2200;t+=20)m.accelerometer({x:2,y:0,z:9.6},t);
  assert.ok(m.frame(2200).dx>0);
}
{
  const m=new Motion();m.calibrate(1000);
  for(let t=1000;t<2500;t+=20){m.accelerometer({x:4,y:4,z:15},t);m.gyroscope({x:1,y:0,z:0},t);}
  assert.equal(m.ready,false);m.frame(9500);assert.equal(m.calibration,null);
  assert.equal(m.gyroscope({x:NaN,y:0,z:0},9600),false);
  assert.equal(m.accelerometer({x:Infinity,y:0,z:0},9600),false);
}
{
  const m=calibrated();m.setArmed(true);m.button('left',1850);
  assert.equal(m.frame(1900).buttons[0].age,50);
  m.frame(2200);assert.equal(m.frame(2600).buttons.length,0);
}
{
  const m=calibrated();m.setArmed(true);m.tapEnabled=true;
  m.accelerometer({x:0,y:0,z:18},1850);assert.equal(m.frame(1850).buttons.length,0);
  m.accelerometer({x:0,y:0,z:9.81},1900);m.accelerometer({x:0,y:0,z:18},2050);
  assert.equal(m.frame(2050).buttons[0].kind,'left');
}
// Real GT4 reported approximately [0.0022, 0.0129, 1.01], in g rather than m/s^2.
const gt4=new Motion({accelUnit:'g',gyroUnit:'rad/s'});gt4.calibrate(1000);
for(let t=1000;t<=2000;t+=20){gt4.accelerometer({x:0.0022,y:0.0129,z:1.01},t);gt4.gyroscope({x:0.0032,y:-0.0085,z:0.0043},t);}
assert.equal(gt4.ready,true);assert.ok(gt4.gravity.z>9.8 && gt4.gravity.z<10);
console.log('Motion tests passed: stationary bias, jitter, movement, gaps, scrolling, tilt, invalid data, double tap and real GT4 g-unit normalization');
