#!/usr/bin/env python3
"""Check the Huawei profile against this app, CSR, certificate and actual watch."""
import base64
import hashlib
import json
import pathlib
import re
import subprocess

PROJECT=pathlib.Path(__file__).resolve().parents[1]
ROOT=PROJECT.parents[1]
signing=ROOT/'.local/signing'
profile_path=signing/'profiles/com.example.gt4counter.p7b'
result=subprocess.run(['openssl','cms','-verify','-noverify','-inform','DER','-in',str(profile_path)],capture_output=True,check=True)
# -noverify skips local CA-chain trust lookup; CMS content signature is still checked.
profile=json.loads(result.stdout)
config=json.loads((PROJECT/'watch/entry/src/main/config.json').read_text())
bundle=config['app']['bundleName']
for permission in config['module'].get('reqPermissions',[]):
    assert permission.get('reason'),'Lite permission reason is required'
    assert permission.get('usedScene',{}).get('when') in ['inuse','always'],'Lite usedScene.when must be inuse or always'
assert profile['type']=='debug','Profile is not debug'
assert profile['bundle-info']['bundle-name']==bundle,'Profile bundle mismatch'
assert (signing/'watch-udid.txt').read_text().strip() in profile['debug-info']['device-ids'],'Current watch missing from Profile'
chain=re.findall(rb'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----',(signing/'gt4counter-debug.cer').read_bytes(),re.S)
csr_key=subprocess.check_output(['openssl','req','-in',str(signing/'gt4counter.csr'),'-pubkey','-noout'])
matching=[c for c in chain if subprocess.check_output(['openssl','x509','-pubkey','-noout'],input=c)==csr_key]
assert len(matching)==1,'No unique certificate matches local CSR'
leaf_der=subprocess.check_output(['openssl','x509','-outform','DER'],input=matching[0])
profile_cert=profile['bundle-info']['development-certificate']
profile_der=(subprocess.check_output(['openssl','x509','-outform','DER'],input=profile_cert.encode()) if '-----BEGIN' in profile_cert else base64.b64decode(profile_cert))
assert leaf_der==profile_der,'Profile certificate mismatch'
report={'type':'debug','bundleName':bundle,'deviceCount':len(profile['debug-info']['device-ids']),'currentWatchIncluded':True,'certificateMatches':True,'profileSha256':hashlib.sha256(profile_path.read_bytes()).hexdigest()}
(PROJECT/'build/signing-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print('Signing validated: bundle, current watch, CMS signature, CSR and issued certificate match')
