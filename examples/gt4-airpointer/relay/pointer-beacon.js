import {PHONE_PACKAGE} from './protocol.js';

// Experimental detect-route transport. Multibyte integers use network (big-endian) order.
// Header: 29 bytes; each button adds 5 bytes, for a maximum of 44 bytes / 88 hex digits.
const PREFIX=PHONE_PACKAGE+'.gt4ptr.x';
const KINDS=['','left','right','double','drag'];
export function decodePointerRoute(route) {
    if(typeof route!=='string' || !route.startsWith(PREFIX))return null;
    const hex=route.slice(PREFIX.length);
    if(!/^[0-9a-f]{58,88}$/.test(hex) || hex.length%2)throw Error('Invalid pointer beacon hex');
    const bytes=[];
    for(let i=0;i<hex.length;i+=2)bytes.push(parseInt(hex.slice(i,i+2),16));
    let offset=0;
    function uint(size) {
        if(offset+size>bytes.length)throw Error('Truncated pointer beacon');
        let value=0;for(let i=0;i<size;i++)value=value*256+bytes[offset++];
        return value;
    }
    function fixed(){const value=uint(2);return (value>=32768?value-65536:value)/100;}
    const version=uint(1),flags=uint(1),hi=uint(6),lo=uint(4),seq=uint(4),sent=uint(6);
    const dx=fixed(),dy=fixed(),scroll=fixed(),count=uint(1);
    if(version!==1 || flags>3 || seq===0 || Math.abs(dx)>100 || Math.abs(dy)>100 || Math.abs(scroll)>60 || count>3)
        throw Error('Invalid pointer beacon fields');
    if(bytes.length!==29+count*5)throw Error('Invalid pointer beacon length');
    const buttons=[];
    for(let i=0;i<count;i++) {
        const kind=uint(1),id=uint(2),age=uint(2);
        if(!KINDS[kind] || id===0)throw Error('Invalid pointer beacon button');
        buttons.push({kind:KINDS[kind],id,age});
    }
    return {v:1,t:'pointer',session:String(hi)+'-'+String(lo),seq,sent,armed:!!(flags&1),dx,dy,scroll,buttons,
        origin:flags&2?'synthetic-watch-test':'real-sensor',backend:'experimental-ping'};
}
