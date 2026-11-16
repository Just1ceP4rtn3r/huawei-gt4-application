// Small explicit RPC state machine; no eval, arbitrary routes, or unrestricted native calls.
function validSession(value){if(typeof value!=='string' || value.length!==16)return false;
    for(var i=0;i<value.length;i++){var c=value.charCodeAt(i);if(!((c>=48 && c<=57)||(c>=97 && c<=102)))return false;}return true;
}
export default function Controller(execute,emit,clock){
    this.execute=execute;this.emit=emit;this.clock=clock;this.session='';this.lastID=0;this.cache=[];this.generation=0;this.enabled=false;this.lease=0;
}
Controller.prototype.receive=function(m){
    if(!m || m.v!==1 || m.t!=='command' || !validSession(m.session) || typeof m.id!=='number' || Math.floor(m.id)!==m.id || m.id<1 || m.id>2147483647 || typeof m.ttl!=='number' || m.ttl<1 || m.ttl>15000)return false;
    var allowed=['hello','status','calibrate','arm','pause','mode','gain','button','pointer','probe','logs','exit','heartbeat','test'];
    if(allowed.indexOf(m.op)<0)return false;
    if(m.op==='hello' && this.session!==m.session){
        this.generation++;this.session=m.session;this.lastID=0;this.cache=[];this.enabled=!!(m.args && m.args.enabled);this.lease=0;
        this.execute('pause',{},function(){});
    }
    if(m.session!==this.session)return false;
    for(var i=0;i<this.cache.length;i++)if(this.cache[i].id===m.id){if(this.cache[i].value)this.emit('ack',this.session,m.id,this.cache[i].value);return true;}
    if(m.id<=this.lastID)return false;this.lastID=m.id;
    if(m.op==='heartbeat'){this.lease=this.clock()+1500;return true;}
    var entry={id:m.id,value:null};this.cache.push(entry);if(this.cache.length>8)this.cache.shift();
    var self=this,generation=this.generation,session=this.session,deadline=this.clock()+m.ttl,completed=false;
    function done(result,error){
        if(completed || generation!==self.generation)return;completed=true;
        var value=error?{ok:false,error:String(error).slice(0,120)}:{ok:true,result:result || {}};
        if(self.clock()>deadline)value={ok:false,error:'Execution deadline exceeded'};
        entry.value=value;self.emit('ack',session,m.id,value);
    }
    if(m.op==='arm' && !this.enabled){done(null,'Desktop input is disabled');return true;}
    if(m.op==='arm')this.lease=this.clock()+1500;
    try{this.execute(m.op,m.args || {},done);}catch(e){done(null,e.message);}
    return true;
};
Controller.prototype.expired=function(){return this.clock()>this.lease;};
Controller.prototype.stop=function(){this.generation++;this.session='';this.enabled=false;this.lease=0;this.cache=[];};
