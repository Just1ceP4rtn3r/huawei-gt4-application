# 来源与许可

本仓库源码按 GNU Affero General Public License v3.0 or later（AGPL-3.0-or-later）提供，完整许可正文见 [LICENSE](LICENSE)。上游版权声明和许可继续适用。

## 构建与协议实现

- 来源：[burak4arslan/huawei-watch-sideload-ios](https://github.com/burak4arslan/huawei-watch-sideload-ios)，固定提交 `c256b8acb95d013e9491b4da05ffeed1f59aeec9`，AGPL-3.0 系列许可。
- `scripts/build-lite.sh` 改编自其 `tools/build-watch-app.sh`：调整工作区路径、以 Python 复制资源并补充构建失败检查。
- `scripts/watch-channel.py` 与 `scripts/phone-bridge.js` 参考该工程的 Huawei 文件传输、应用安装和帧封装逻辑；上游说明相关协议代码源自 [Gadgetbridge](https://codeberg.org/Freeyourgadget/Gadgetbridge)，遵循其 AGPL 许可。
- 本地包检查动态调用上游 `tools/check-watch-bin.py`；原文件由 `setup.sh` 下载至被 Git 忽略的 `tools/`，不在这里重复分发。
- 计数器页面、工作区脚本、签名一致性检查和文档为本次新增；协议适配还核对了本机已有 CrescentRelay 的会话布局，未包含其手机工程。

## 下载的工具和运行依赖

`setup.sh` 获取 OpenHarmony SDK、Node.js、Frida、esbuild、frida-objc-bridge 和 @noble 系列依赖。它们不作为二进制或 vendor 源码上传，下载后附带的版权声明和许可应保留。仓库的 AGPL 声明不替代这些工具各自的许可。

下载链接和参考资料见 [docs/SOURCES.md](docs/SOURCES.md) 及 `scripts/setup.sh`。SDK 与 Node 下载有摘要检查，参考 Git 工程固定提交，npm 顶层依赖固定版本。
