// Application-owned diagnostics only. No credentials, peer certificates or sensor samples.
var records=[],started=Date.now(),sequence=0;
function safeString(value){
    // Lite JerryScript may be built without RegExp: use bounded character scans.
    var ascii='',out='',run='';
    for(var i=0;i<Math.min(value.length,256);i++){var c=value.charCodeAt(i);ascii+=c>=32 && c<=126?value.charAt(i):'?';}
    for(var j=0;j<=ascii.length;j++){
        var ch=ascii.charAt(j),code=ascii.charCodeAt(j);
        if(j<ascii.length && ((code>=48 && code<=57) || (code>=65 && code<=90) || (code>=97 && code<=122) || ch==='+' || ch==='/' || ch==='=' || ch==='_' || ch==='-'))run+=ch;
        else {out+=run.length>=48?'[redacted]':run;run='';out+=ch;}
    }
    return out.slice(0,72);
}
function scalar(value){
    if(value===undefined)return 'undefined';if(value===null)return null;
    if(typeof value==='number' || typeof value==='boolean')return value;
    if(typeof value==='string')return safeString(value);
    if(typeof value==='object'){
        var out={};var keys=['code','errorCode','message','reason','isRegister'];
        for(var i=0;i<keys.length;i++)if(value[keys[i]]!==undefined)out[keys[i]]=typeof value[keys[i]]==='object'?'[object]':scalar(value[keys[i]]);
        return out;
    }
    return typeof value;
}
export default {
    reset:function(){records=[];started=Date.now();sequence=0;},
    add:function(event,args){
        var values=[];for(var i=0;args && i<Math.min(args.length,3);i++)values.push(scalar(args[i]));
        records.push([++sequence,Date.now()-started,event,values]);if(records.length>24)records.shift();
    },
    snapshot:function(){
        var selected=records.slice(-12),out=JSON.stringify({v:1,t:'watchlog',events:selected});
        while(out.length>960 && selected.length>1){selected.shift();out=JSON.stringify({v:1,t:'watchlog',events:selected});}
        return out;
    },
    line:function(index){if(!records.length)return 'No local log yet';var r=records[((index%records.length)+records.length)%records.length];return '#'+r[0]+' +'+r[1]+'ms\n'+r[2]+'\nargc='+r[3].length+' '+JSON.stringify(r[3]);},
    latest:function(){return this.line(records.length-1);},
    count:function(){return records.length;}
};
