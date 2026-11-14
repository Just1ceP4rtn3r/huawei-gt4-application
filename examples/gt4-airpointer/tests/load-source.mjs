// Native Lite compilation uses CommonJS package mode. Load pure source as ESM for offline tests.
import fs from 'node:fs';
export async function sourceModule(url) {
  const source=fs.readFileSync(url,'utf8');
  return import('data:text/javascript;charset=utf-8,'+encodeURIComponent(source));
}
