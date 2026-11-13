#!/bin/bash
# Recreate the isolated macOS ARM64 build environment inside this directory.
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$GT4_ROOT"
[ "$(uname -sm)" = 'Darwin arm64' ] || { echo 'This setup targets macOS ARM64.' >&2; exit 1; }
command -v java >/dev/null
if [ ! -d tools/huawei-watch-sideload-ios/.git ]; then
  git -c credential.helper= clone https://github.com/burak4arslan/huawei-watch-sideload-ios.git tools/huawei-watch-sideload-ios
  git -C tools/huawei-watch-sideload-ios checkout --detach c256b8acb95d013e9491b4da05ffeed1f59aeec9
fi
download() { [ -f "$2" ] || curl -fL --connect-timeout 15 --max-time 300 "$1" -o "$2"; }
download https://repo.huaweicloud.com/openharmony/os/3.2-Release/L2-SDK-MAC-M1-PUBLIC.tar.gz tools/ohos-sdk-mac-m1.tar.gz
download https://nodejs.org/dist/v16.20.2/node-v16.20.2-darwin-arm64.tar.gz tools/node-v16.20.2-darwin-arm64.tar.gz
download https://nodejs.org/dist/v16.20.2/SHASUMS256.txt tools/node-v16.20.2-SHASUMS256.txt
/usr/bin/python3 - <<'PY'
import pathlib, hashlib, tarfile, zipfile
root=pathlib.Path('.').resolve()
sdk=root/'tools/ohos-sdk-mac-m1.tar.gz'
assert hashlib.sha256(sdk.read_bytes()).hexdigest()=='42444ed280e6dcead7b5c9aa0e20c8df80cae75b6d9e20bc4eb9ced8a617906d','SDK checksum mismatch'
node=root/'tools/node-v16.20.2-darwin-arm64.tar.gz'
expected=next(x.split()[0] for x in (root/'tools/node-v16.20.2-SHASUMS256.txt').read_text().splitlines() if x.endswith(node.name))
assert hashlib.sha256(node.read_bytes()).hexdigest()==expected,'Node checksum mismatch'
if not (root/'tools/node-v16.20.2-darwin-arm64/bin/node').exists():
    with tarfile.open(node) as t:
        assert all((root/'tools'/m.name).resolve().is_relative_to(root/'tools') for m in t.getmembers())
        t.extractall(root/'tools')
if not (root/'tools/ohos-sdk/9/js/oh-uni-package.json').exists():
    with tarfile.open(sdk) as t:
        for m in t.getmembers():
            if '/js-' not in m.name and '/toolchains-' not in m.name: continue
            archive=root/'tools'/pathlib.Path(m.name).name
            archive.write_bytes(t.extractfile(m).read())
            with zipfile.ZipFile(archive) as z:
                for item in z.infolist():
                    target=(root/'tools/ohos-sdk/9'/item.filename).resolve()
                    assert target.is_relative_to(root/'tools/ohos-sdk/9')
                    z.extract(item,root/'tools/ohos-sdk/9')
                    mode=item.external_attr>>16
                    if mode&0o111: target.chmod(mode&0o777)
print('SDK and Node archives verified')
PY
export PATH="$GT4_ROOT/tools/node-v16.20.2-darwin-arm64/bin:$PATH"
if [ ! -f "$OHOS_SDK/js/build-tools/ace-loader/node_modules/webpack/bin/webpack.js" ]; then
  npm ci --prefix "$OHOS_SDK/js/build-tools/ace-loader" --legacy-peer-deps --no-audit --no-fund
fi
if [ ! -d "$GT4_ROOT/tools/frida-matched/frida" ]; then
  /usr/bin/python3 -m pip install --target "$GT4_ROOT/tools/frida-matched" --no-deps frida==17.23.2
fi
if [ ! -f "$GT4_ROOT/tools/frida-agent/package-lock.json" ]; then
  npm install --prefix tools/frida-agent --save-exact esbuild@0.28.2 frida-objc-bridge@8.0.6 @noble/ciphers@2.4.0 @noble/hashes@2.4.0 --no-audit --no-fund
elif [ ! -x "$GT4_ROOT/tools/frida-agent/node_modules/.bin/esbuild" ]; then
  npm ci --prefix tools/frida-agent --no-audit --no-fund
fi
echo 'Workspace-local environment ready. bash scripts/build.sh --unsigned'
