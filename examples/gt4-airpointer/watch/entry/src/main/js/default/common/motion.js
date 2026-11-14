// Original motion logic. Time is passed explicitly for deterministic replay tests.
function finite(n) { return typeof n === 'number' && isFinite(n); }
function valid(v) { return v && finite(v.x) && finite(v.y) && finite(v.z); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function norm(v) { return Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z); }
function angle(a, b) { return Math.atan2(a, b); }
function deltaAngle(a, b) { var d=a-b; while(d>Math.PI)d-=2*Math.PI; while(d< -Math.PI)d+=2*Math.PI; return d; }
function soft(n, zone) { return Math.abs(n) < zone ? 0 : n-(n>0?zone:-zone); }
function resetSamples(c){c.count=0;c.x=0;c.y=0;c.z=0;c.squares=0;c.accels=0;c.stableSince=null;}

export default function Motion(options) {
    this.options=options || {};
    this.bias={x:0,y:0,z:0}; this.gravity=null; this.base=null;
    this.lastAccel=0; this.lastGyro=0; this.lastSample=null;
    this.gyroAvailable=true; this.ready=false; this.armed=false;
    this.mode='pointer'; this.hand=1; this.gain=1;
    this.tapEnabled=false; this.tapCount=0; this.firstTap=null; this.lastPeak=-10000;
    this.quietSince=null; this.gyroNorm=0; this.calibration=null;
    this.dx=0; this.dy=0; this.scroll=0; this.vx=0; this.vy=0;
    this.events=[]; this.nextEvent=0; this.calibrationStatus='Calibrate first';
}
Motion.prototype.clear=function() { this.dx=0;this.dy=0;this.scroll=0;this.vx=0;this.vy=0;this.lastSample=null;this.tapCount=0;this.firstTap=null;this.events=[]; };
Motion.prototype.setArmed=function(value) { this.clear();this.armed=!!value && this.ready && !this.calibration;return this.armed; };
Motion.prototype.setMode=function(value) { this.mode=value==='scroll'?'scroll':'pointer';this.setArmed(false); };
Motion.prototype.calibrate=function(now) {
    this.setArmed(false);this.ready=false;this.base=null;
    this.calibration={started:now};resetSamples(this.calibration);
    this.calibrationStatus='Hold still';
};
Motion.prototype.setGyroAvailable=function(value) { this.gyroAvailable=!!value;this.setArmed(false); };
Motion.prototype.failCalibration=function() { this.calibration=null;this.ready=false;this.calibrationStatus='Not still - retry'; };
Motion.prototype.finishCalibration=function() {
    var c=this.calibration,n=c.count;
    if(this.gyroAvailable && n<25)return;
    if(!this.gravity || c.accels<15)return;
    var b={x:0,y:0,z:0};
    if(this.gyroAvailable) {
        b={x:c.x/n,y:c.y/n,z:c.z/n};
        var variance=Math.max(0,c.squares/n-b.x*b.x-b.y*b.y-b.z*b.z);
        if(variance>0.0012){resetSamples(c);return;}
    }
    this.bias=b;this.base={x:angle(this.gravity.x,this.gravity.z),y:angle(this.gravity.y,this.gravity.z)};
    this.calibration=null;this.ready=true;this.calibrationStatus='Ready';this.clear();
};
Motion.prototype.accelerometer=function(value,now) {
    if(!valid(value))return false;
    var scale=this.options.accelUnit==='g'?9.80665:1;
    value={x:value.x*scale,y:value.y*scale,z:value.z*scale};
    if(norm(value)>100)return false;
    var g=norm(value);this.lastAccel=now;
    if(!this.gravity)this.gravity={x:value.x,y:value.y,z:value.z};
    var old=this.gravity;
    var dynamic=norm({x:value.x-old.x,y:value.y-old.y,z:value.z-old.z});
    var alpha=0.12;
    this.gravity={x:old.x+alpha*(value.x-old.x),y:old.y+alpha*(value.y-old.y),z:old.z+alpha*(value.z-old.z)};
    if(dynamic<0.8){if(this.quietSince===null)this.quietSince=now;} else if(dynamic>2)this.quietSince=null;
    if(this.calibration) {
        var c=this.calibration;
        if(now-c.started>8000){this.failCalibration();return true;}
        if(g<8 || g>11.8 || dynamic>1.2){resetSamples(c);return true;}
        c.accels++;
        if(c.stableSince===null)c.stableSince=now;
        if(now-c.stableSince>=650)this.finishCalibration();
        return true;
    }
    if(this.armed && this.tapEnabled && dynamic>6.5 && dynamic<25 && this.gyroNorm<0.65 && now-this.lastPeak>130) {
        this.lastPeak=now;
        if(this.firstTap!==null && now-this.firstTap>=140 && now-this.firstTap<=420) {
            this.button('left',now);this.firstTap=null;this.lastPeak=now+400;
        } else this.firstTap=now;
    }
    if(!this.gyroAvailable && this.ready) {
        var x=deltaAngle(angle(this.gravity.x,this.gravity.z),this.base.x);
        var y=deltaAngle(angle(this.gravity.y,this.gravity.z),this.base.y);
        this.integrate(soft(x,0.055)*850*this.hand,soft(y,0.055)*850,now);
    }
    return true;
};
Motion.prototype.gyroscope=function(value,now) {
    if(!valid(value))return false;
    var scale=this.options.gyroUnit==='deg/s'?Math.PI/180:1;
    var v={x:value.x*scale,y:value.y*scale,z:value.z*scale};
    if(norm(v)>30)return false;
    this.lastGyro=now;this.gyroNorm=norm(v);
    if(this.calibration) {
        var c=this.calibration;
        if(now-c.started>8000){this.failCalibration();return true;}
        if(norm(v)>0.3){resetSamples(c);return true;}
        c.count++;c.x+=v.x;c.y+=v.y;c.z+=v.z;c.squares+=v.x*v.x+v.y*v.y+v.z*v.z;
        if(c.stableSince!==null && now-c.stableSince>=650)this.finishCalibration();
        return true;
    }
    if(!this.gyroAvailable || !this.ready)return true;
    var yaw=this.options.yawAxis || 'z',pitch=this.options.pitchAxis || 'x';
    var rx=soft(v[yaw]-this.bias[yaw],0.018)*(this.options.yawSign || -1)*this.hand;
    var ry=soft(v[pitch]-this.bias[pitch],0.018)*(this.options.pitchSign || -1);
    this.integrate(rx*750,ry*750,now);
    return true;
};
Motion.prototype.integrate=function(x,y,now) {
    if(!this.armed){this.lastSample=null;return;}
    if(this.lastSample===null){this.lastSample=now;return;}
    var dt=(now-this.lastSample)/1000;this.lastSample=now;
    if(dt<=0 || dt>0.12){this.dx=0;this.dy=0;this.scroll=0;this.vx=0;this.vy=0;return;}
    var a=dt/(0.035+dt);
    this.vx+=a*(x-this.vx);this.vy+=a*(y-this.vy);
    if(this.mode==='scroll')this.scroll=clamp(this.scroll-this.vy*dt*0.25*this.gain,-60,60);
    else {
        this.dx=clamp(this.dx+this.vx*dt*this.gain,-100,100);
        this.dy=clamp(this.dy+this.vy*dt*this.gain,-100,100);
    }
};
Motion.prototype.button=function(kind,now) {
    if(!this.ready || !this.armed || ['left','right','double','drag'].indexOf(kind)<0)return false;
    if(this.events.length>=8)return false;
    this.events.push({id:++this.nextEvent,kind:kind,at:now});return true;
};
Motion.prototype.frame=function(now) {
    if(this.calibration && now-this.calibration.started>8000)this.failCalibration();
    var latest=this.gyroAvailable?this.lastGyro:this.lastAccel;
    if(this.armed && now-latest>250)this.setArmed(false);
    this.events=this.events.filter(function(e){return now-e.at<=700;});
    var result={armed:this.armed,dx:Math.round(this.dx*100)/100,dy:Math.round(this.dy*100)/100,scroll:Math.round(this.scroll*100)/100,
        buttons:this.events.map(function(e){return {id:e.id,kind:e.kind,age:Math.max(0,now-e.at)};})};
    this.dx=0;this.dy=0;this.scroll=0;
    return result;
};
