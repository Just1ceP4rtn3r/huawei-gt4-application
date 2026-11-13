#!/usr/bin/env python3
"""Verify a legacy Lite binary's CMS signature and 4096-byte aggregate digest."""
import hashlib
import importlib.util
import json
import pathlib
import struct
import subprocess
import sys

root=pathlib.Path(__file__).resolve().parents[1]
path=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else root/'artifacts/GT4 Counter.bin'
data=path.read_bytes()
spec=importlib.util.spec_from_file_location('bin_check',root/'tools/huawei-watch-sideload-ios/tools/check-watch-bin.py')
checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(checker)
bundle,errors,notes=checker.check(path)
assert not errors,'; '.join(errors)
_,_,signed_size=checker.entries(data)
unsigned_size=len(data)-signed_size
profile_type,_,profile_size,profile_offset=struct.unpack('>BBHI',data[unsigned_size:unsigned_size+8])
_,_,_,signature_offset=struct.unpack('>BBHI',data[unsigned_size+8:unsigned_size+16])
assert profile_type==2 and profile_offset==unsigned_size+16
assert signature_offset==profile_offset+profile_size
assert data[profile_offset:signature_offset]==(root/'.local/signing/profiles/com.example.gt4counter.p7b').read_bytes()
signature=data[signature_offset:-32]
result=subprocess.run(['openssl','cms','-verify','-noverify','-inform','DER'],input=signature,capture_output=True,check=True)
content=result.stdout
assert content[:4]==b'1000' and len(content)==48,'Unsupported digest container'
assert struct.unpack('>H',content[10:12])[0]==6,'Expected SHA256 digest algorithm'
assert struct.unpack('>I',content[12:16])[0]==32,'Expected 32-byte digest'
covered=data[:signature_offset]
digest=hashlib.sha256(b''.join(hashlib.sha256(covered[i:i+4096]).digest() for i in range(0,len(covered),4096))).digest()
assert content[-32:]==digest,'Signed package digest mismatch'
report={'bundleName':bundle,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'cmsSignatureValid':True,'aggregateDigestValid':True,'approvedProfileEmbedded':True,'structureValid':True}
(root/'artifacts/package-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print('Lite binary verified: CMS signature, 4096-byte aggregate digest, embedded Profile and resource structure')
