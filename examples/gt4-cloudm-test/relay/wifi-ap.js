// Native iOS sample-config AP command, recovered from the user's reverse archive.
// AP only: no firmware negotiation, transfer, or installation.
import {tlv,bytes} from './protocol.js';
export function apBody(action){
  if(action!==3 && action!==5)throw Error('Only AP open/close');
  let row=[...tlv(5,[0x35,0xa6,0x6f,0xb3]),...tlv(6,[action])];
  if(action===3)row.push(...tlv(7,bytes(JSON.stringify({EncryptedType:0,countrycode:'',authtype:2}))));
  const pkg=bytes('hw.uniedevice.wifiTransfer');
  return [...tlv(1,pkg),...tlv(2,pkg),...tlv(0x83,tlv(0x84,row))];
}
// Strict whitelist: SSID, password and any other opaque strings never leave the phone.
export function apSummary(fields,parse){
  const result={rows:[]};
  if(fields[127])result.status=fields[127].reduce((n,b)=>n*256+b,0);
  const rows=parse(fields[0x83]||[]),f=rows[0x84];if(!f)return result;
  const row=parse(f),type=(row[5]||[]).reduce((n,b)=>n*256+b,0);
  if(type!==900100019)return result;
  const data={configType:type,action:(row[6]||[])[0]};
  if(row[7]){
    const raw=JSON.parse(String.fromCharCode(...row[7]));
    if(typeof raw.ap_status==='number')data.apStatus=raw.ap_status;
    data.hasSSID=typeof raw.ssid==='string' && !!raw.ssid;
    data.hasPassword=typeof raw.password==='string' && !!raw.password;
    data.sockets=(Array.isArray(raw.socket_info)?raw.socket_info:[]).slice(0,2).map((s,i)=>({role:i===0?'data':'command',ip:/^\d{1,3}(\.\d{1,3}){3}$/.test(s.ip)?s.ip:null,port:Number.isInteger(s.port)?s.port:null}));
  }
  result.rows.push(data);return result;
}
