// Wear Engine P2P wire shape follows HuaSideload/Gadgetbridge (AGPL-3.0-or-later).
export const WATCH_PACKAGE='com.example.gt4counter';
export const PHONE_PACKAGE='local.gt4bridge.crescent';
export const PHONE_ROUTES=[PHONE_PACKAGE,'local.gt4airpointer.relay'];
export const PHONE_FINGERPRINT='41AA272C4F19BC53493F79B526855CBEA93B9311A82EEA18E98F5A2163776A28';
// Diagnostic pings carry application-owned, ASCII-only logs, never pointer input.
export function diagnosticPart(route,namespace='gt4log') {
    const prefix=PHONE_PACKAGE+'.'+namespace+'.';
    if(!route.startsWith(prefix))return null;
    const match=/^s([0-9a-f]{8})\.p([1-9][0-9]?)n([1-9][0-9]?)\.x([0-9a-f]{2,96})$/.exec(route.slice(prefix.length));
    if(!match || match[4].length%2 || +match[2]>+match[3] || +match[3]>20)throw Error('Invalid diagnostic fragment');
    const data=[];for(let i=0;i<match[4].length;i+=2)data.push(parseInt(match[4].slice(i,i+2),16));
    return {session:match[1],part:+match[2],total:+match[3],text:ascii(data)};
}
export function ascii(bytes) {
    if(!bytes || bytes.length>4096 || bytes.some(function(b){return b>127;}))throw Error('Expected bounded ASCII');
    return String.fromCharCode.apply(null,bytes);
}
export function bytes(text) {
    if(typeof text!=='string' || text.length>4096)throw Error('Text budget exceeded');
    var out=[];for(var i=0;i<text.length;i++){var n=text.charCodeAt(i);if(n>127)throw Error('Non-ASCII text');out.push(n);}return out;
}
export function tlv(tag,value) {
    var size=value.length,length=[size&127];while(size>>=7)length.unshift((size&127)|128);
    return [tag].concat(length,value);
}
export function parse(data) {
    if(data.length>8192)throw Error('P2P payload too large');
    var out={},i=0;
    while(i<data.length){
        var tag=data[i++],n=0,b,steps=0;
        if(i===data.length && tag===0)break; // Huawei TLV permits a final zero terminator.
        if(Object.prototype.hasOwnProperty.call(out,tag))throw Error('Duplicate P2P tag');
        do {if(i>=data.length || ++steps>3)throw Error('Invalid TLV length');b=data[i++];n=n*128+(b&127);}while(b&128);
        if(i+n>data.length)throw Error('Truncated TLV');out[tag]=data.slice(i,i+n);i+=n;
    }
    return out;
}
export function decode(data,expectedFingerprint) {
    var f=parse(data);
    if(!f[1] || f[1].length!==1 || !f[2] || f[2].length!==2)return null;
    var peerPackage=ascii(f[4]);
    if(ascii(f[3])!==WATCH_PACKAGE)return null;
    var kind=f[1][0];if(kind===3)return null;
    var diagnostic=kind===1?diagnosticPart(peerPackage):null;
    var managed=kind===1?diagnosticPart(peerPackage,'gt4rpc'):null;
    if(!diagnostic && !managed && PHONE_ROUTES.indexOf(peerPackage)<0)return null;
    if(kind!==1 && kind!==2)throw Error('Unknown P2P kind');
    if(kind===2 && (ascii(f[5])!==expectedFingerprint || ascii(f[6])!==PHONE_FINGERPRINT))throw Error('P2P fingerprint mismatch');
    var payload=kind===2?JSON.parse(ascii(f[7])):null;
    if(payload && (payload.v!==1 || (payload.t!=='probe' && (payload.t!=='pointer' || typeof payload.session!=='string' || !Number.isSafeInteger(payload.seq)))))throw Error('Not an allowed application frame');
    return {peerPackage:peerPackage,kind:kind,sequence:f[2],sourceFingerprint:f[5],destinationFingerprint:f[6],payload:payload,diagnostic:diagnostic,managed:managed};
}
export function ack(message) {
    var code=message.kind===1?205:207;
    return [].concat(tlv(1,[3]),tlv(2,message.sequence),tlv(3,bytes(message.peerPackage || PHONE_PACKAGE)),tlv(4,bytes(WATCH_PACKAGE)),tlv(8,[0,0,0,code]));
}
export function status(message,sequence,enabled) {
    return [].concat(tlv(1,[2]),tlv(2,[sequence>>8,sequence&255]),tlv(3,bytes(message.peerPackage || PHONE_PACKAGE)),tlv(4,bytes(WATCH_PACKAGE)),
        tlv(5,bytes(PHONE_FINGERPRINT)),tlv(6,message.sourceFingerprint),tlv(7,bytes(JSON.stringify({v:1,t:'relay',enabled:!!enabled}))));
}
