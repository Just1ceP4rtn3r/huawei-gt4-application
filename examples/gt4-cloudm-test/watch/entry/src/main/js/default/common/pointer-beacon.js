// Compact, latest-motion-only fallback. Delayed clicks and motion are never replayed.
function clamp(v,n){return Math.max(-n,Math.min(n,Number(v)||0));}
export default function PointerBeacon(peer){this.peer=peer;this.hi=Date.now();this.lo=Math.floor(Math.random()*1000000);this.seq=0;this.pending=null;}
PointerBeacon.prototype.push=function(frame,now,synthetic){
    var old=this.pending,armed=!!frame.armed;
    if(!old || old.synthetic!==!!synthetic || old.armed!==armed || now-old.start>250)old={dx:0,dy:0,scroll:0,start:now};
    old.armed=armed;old.synthetic=!!synthetic;old.at=now;
    old.dx=armed?clamp(old.dx+frame.dx,100):0;old.dy=armed?clamp(old.dy+frame.dy,100):0;old.scroll=armed?clamp(old.scroll+frame.scroll,60):0;
    old.buttons=armed?(frame.buttons || []).filter(function(b){return b.age<=350;}).slice(-3):[];
    this.pending=old;
};
PointerBeacon.prototype.take=function(now){
    var p=this.pending;this.pending=null;if(!p)return null;
    if(now-p.at>(p.synthetic?1000:250))return null;
    var out=[];
    function uint(n,size){for(var i=size-1;i>=0;i--)out.push(Math.floor(n/Math.pow(256,i))&255);}
    function fixed(n){n=Math.round(n*100);uint(n<0?n+65536:n,2);}
    uint(1,1);uint((p.armed?1:0)+(p.synthetic?2:0),1);uint(this.hi,6);uint(this.lo,4);uint(++this.seq,4);uint(p.at,6);
    fixed(p.dx);fixed(p.dy);fixed(p.scroll);uint(p.buttons.length,1);
    for(var i=0;i<p.buttons.length;i++){var b=p.buttons[i];uint(['','left','right','double','drag'].indexOf(b.kind),1);uint(b.id%65535 || 1,2);uint(Math.max(0,Math.round(b.age)),2);}
    var hex='';for(var j=0;j<out.length;j++)hex+=('0'+out[j].toString(16)).slice(-2);
    return this.peer+'.gt4ptr.x'+hex;
};
PointerBeacon.prototype.clear=function(){this.pending=null;};
