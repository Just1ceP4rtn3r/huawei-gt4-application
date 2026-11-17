// Bounded, latest-motion-only sender. Button IDs repeat briefly; desktop deduplicates.
export default function Transport(api,options) {
    this.api=api;this.options=options;this.session=String(Date.now())+'-'+String(Math.floor(Math.random()*1000000));
    this.sequence=0;this.pending=null;this.busy=false;this.generation=0;this.closed=false;
    this.report=function(){};this.timer=null;
}
Transport.prototype.push=function(frame) {
    if(this.closed)return;
    frame.v=1;frame.t='pointer';frame.session=this.session;frame.seq=++this.sequence;frame.sent=Date.now();
    if(JSON.stringify(frame).length>900)delete frame.diag;
    this.pending=frame;this.flush();
};
Transport.prototype.flush=function() {
    if(this.closed || this.busy || !this.pending)return;
    var self=this,frame=this.pending,epoch=this.generation;this.pending=null;this.busy=true;
    var finished=false;
    function done(ok,code,data) {
        if(finished || self.closed || epoch!==self.generation)return;finished=true;
        clearTimeout(self.timer);self.timer=null;self.busy=false;var detail='';try{detail=typeof data==='string'?data:JSON.stringify(data);}catch(e){detail=String(data);}
        self.report(ok?'Phone accepted':('Send failed '+(typeof code==='number'?String(code):'')+' '+String(detail || 'empty callback').slice(0,120)));
        // A failed native send closes the connection; avoid repeated failure floods and leave room for diagnostics.
        if(!ok){self.closed=true;self.pending=null;return;}
        // Never replay old relative deltas after a stall. A newer frame supersedes this one.
        self.flush();
    }
    this.timer=setTimeout(function(){
        if(finished || self.closed || epoch!==self.generation)return;
        // A native send may still be running: stop this sender rather than spawn concurrent sends.
        finished=true;self.closed=true;self.pending=null;self.report('Link timeout - reconnect');
    },5000);
    try {
        this.api.sendMsg({deviceId:'remote',bundleName:this.options.peerPackage,abilityName:'',message:JSON.stringify(frame),
            success:function(){done(true);},fail:function(data,code){done(false,code,data);}});
    }catch(e){done(false);}
};
Transport.prototype.stop=function() { this.generation++;this.closed=true;this.pending=null;clearTimeout(this.timer);this.timer=null; };
