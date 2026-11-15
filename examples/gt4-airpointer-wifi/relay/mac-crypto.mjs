import crypto from 'node:crypto';
import {parse,tlv} from './protocol.js';
function valid(key){if(!Buffer.isBuffer(key)||![16,24,32].includes(key.length))throw Error('Invalid session key');}
export function sealFrame(key,body){valid(key);const iv=crypto.randomBytes(16),c=crypto.createCipheriv(`aes-${key.length*8}-gcm`,key,iv);const data=Buffer.concat([c.update(Buffer.from(body)),c.final(),c.getAuthTag()]);return [...tlv(124,[1]),...tlv(125,[...iv]),...tlv(126,[...data])];}
export function unsealFrame(key,body){valid(key);const f=parse(body);if(f[124]?.length!==1||f[124][0]!==1||f[125]?.length!==16||!f[126]||f[126].length<16)throw Error('Encrypted P2P required');const data=Buffer.from(f[126]),d=crypto.createDecipheriv(`aes-${key.length*8}-gcm`,key,Buffer.from(f[125]));d.setAuthTag(data.subarray(-16));return [...Buffer.concat([d.update(data.subarray(0,-16)),d.final()])];}
