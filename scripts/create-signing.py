#!/usr/bin/env python3
"""Generate this workspace's signing key/CSR, preserving existing keys."""
import os
import pathlib
import secrets
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
signing = root / '.local/signing'
signing.mkdir(parents=True, exist_ok=True)
signing.chmod(0o700)
(signing / 'profiles').mkdir(exist_ok=True)
config = signing / 'signing.env'
if not config.exists():
    config.write_text('SIGN_KEY_ALIAS=gt4counter\nSIGN_KEYSTORE=gt4counter.p12\nSIGN_CERT=gt4counter-debug.cer\nSIGN_PASSWORD_FILE=password.txt\n')
    config.chmod(0o600)
password_file = signing / 'password.txt'
if not password_file.exists():
    password_file.write_text(secrets.token_urlsafe(24))
password_file.chmod(0o600)
password = password_file.read_text().strip()
jar = root/'tools/ohos-sdk/9/toolchains/lib/hap-sign-tool.jar'
key = signing/'gt4counter.p12'
csr = signing/'gt4counter.csr'
common = ['-keyAlias','gt4counter','-keyPwd',password,'-keystoreFile',str(key),'-keystorePwd',password]
def execute(arguments):
    result = subprocess.run(['java','-jar',str(jar)]+arguments, capture_output=True, text=True)
    if result.returncode or 'ERROR' in result.stdout:
        raise RuntimeError((result.stdout+result.stderr).replace(password, '[REDACTED]'))
if not key.exists():
    execute(['generate-keypair']+common+['-keyAlg','ECC','-keySize','NIST-P-256'])
    key.chmod(0o600)
if not csr.exists():
    execute(['generate-csr']+common+['-subject','C=CN,O=Local Development,OU=GT4,CN=GT4 Counter','-signAlg','SHA256withECDSA','-outFile',str(csr)])
print('Key preserved in .local/signing/gt4counter.p12; CSR ready:',csr)
