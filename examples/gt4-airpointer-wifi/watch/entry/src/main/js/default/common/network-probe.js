// Explicit native probes. HTTP is restricted to the controlled Mac test endpoint.
var epoch=0,timer=null,busy=false;
function load(api){
    if(api==='socket')return requireModule('@ohos.net.socket');
    if(api==='http')return requireModule('@ohos.net.http');
    if(api==='websocket')return requireModule('@ohos.net.webSocket');
    if(api==='fetch')return requireModule('@system.fetch');
    if(api==='network')return requireModule('@system.network');
    throw Error('Unsupported probe API');
}
function moduleName(api){return api==='fetch' || api==='network'?'@system.'+api:'@ohos.net.'+(api==='websocket'?'webSocket':api);}
function error(out,e){out.ok=false;out.error=String(e && e.message || e || 'Unknown error').slice(0,100);
    if(e && (typeof e.code==='number' || typeof e.code==='string'))out.code=String(e.code).slice(0,32);return out;}
export function cancel(){epoch++;clearTimeout(timer);timer=null;busy=false;}
export function probe(args,callback){
    args=args || {};var api=args.api,action=args.action || 'inspect';
    var out={module:moduleName(api),name:api,action:action,ok:false};
    if(['socket','http','websocket','fetch','network'].indexOf(api)<0){callback(error(out,'Unsupported probe API'));return;}
    if(action!=='inspect' && action!=='create' && action!=='request'){callback(error(out,'Unsupported action'));return;}
    if(busy){callback(error(out,'Probe busy'));return;}
    busy=true;var generation=++epoch,mod,finished=false;
    function finish(){if(finished || generation!==epoch)return;finished=true;clearTimeout(timer);timer=null;busy=false;callback(out);}
    try{mod=load(api);out.type=typeof mod;}catch(e){error(out,e);finish();return;}
    if(action==='request'){
        if(api!=='fetch' || !mod || typeof mod.fetch!=='function'){error(out,'Fetch unavailable');finish();return;}
        var nonce=args.nonce || '',prefix='http://192.168.5.22:18765/gt4-probe/';
        if(nonce.length!==32){error(out,'Invalid probe nonce');finish();return;}
        for(var c=0;c<nonce.length;c++)if('0123456789abcdef'.indexOf(nonce.charAt(c))<0){error(out,'Invalid probe nonce');finish();return;}
        var started=Date.now();out.endpoint=prefix;out.completedCallback=false;
        timer=setTimeout(function(){out.ms=Date.now()-started;error(out,'Fetch callback timeout 6000ms');finish();},6000);
        try{mod.fetch({url:prefix+nonce,method:'GET',responseType:'text',
            success:function(value){if(finished || generation!==epoch)return;out.ms=Date.now()-started;out.code=value && value.code;out.echoMatch=!!value && value.data==='GT4-NET-'+nonce;out.ok=out.code===200 && out.echoMatch;finish();},
            fail:function(data,code){if(finished || generation!==epoch)return;out.ms=Date.now()-started;error(out,data);if(code!==undefined)out.code=String(code).slice(0,32);finish();},
            complete:function(){if(!finished && generation===epoch)out.completedCallback=true;}});
        }catch(e){error(out,e);finish();}return;
    }
    if(action==='inspect'){
        var names=api==='socket'?['constructTCPSocketInstance','constructUDPSocketInstance']:
            api==='http'?['createHttp']:api==='websocket'?['createWebSocket']:api==='fetch'?['fetch']:['getType','subscribe','unsubscribe'];
        out.methods={};
        try{for(var i=0;i<names.length;i++)out.methods[names[i]]=mod?typeof mod[names[i]]:'undefined';out.ok=mod!==null && mod!==undefined;}
        catch(e){error(out,e);}finish();return;
    }
    if(api!=='socket'){error(out,'Create is socket-only');finish();return;}
    var kinds=args.kind?[args.kind]:['tcp','udp'],position=0;out.items=[];out.ok=true;
    if(kinds[0]!=='tcp' && kinds[0]!=='udp'){error(out,'Invalid socket kind');finish();return;}
    function next(){
        if(generation!==epoch)return;
        if(position===kinds.length){finish();return;}
        var kind=kinds[position++],item={name:kind,created:false,closed:false},socket,completed=false;
        out.items.push(item);
        function closed(e){if(completed || generation!==epoch)return;completed=true;clearTimeout(timer);timer=null;
            if(e){error(item,e);out.ok=false;}else {item.closed=true;item.ok=true;}next();}
        try{
            var method=kind==='tcp'?'constructTCPSocketInstance':'constructUDPSocketInstance';
            if(!mod || typeof mod[method]!=='function')throw Error('Constructor unavailable');
            socket=mod[method]();item.created=!!socket;item.closeType=socket?typeof socket.close:'undefined';
            if(!socket || typeof socket.close!=='function')throw Error('Close unavailable');
            timer=setTimeout(function(){closed('Close timeout 5000ms');},5000);
            // SDK9: close(callback: AsyncCallback<void>): void; close(): Promise<void>.
            var result=socket.close(function(e){closed(e);});
            if(result && typeof result.then==='function')result.then(function(){closed();},closed);
        }catch(e){closed(e);}
    }
    next();
}
