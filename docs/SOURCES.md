# 来源与技术选择

## 官方依据

- [Lite Wearable 开发指南](https://developer.huawei.com/consumer/cn/doc/lite-wearable-guides/lite-wearable-bpta-guide/)：GT 系列的 JS/HML/CSS 应用、布局和官方真机安装流程。官方流程依赖运动健康和应用调测助手；不能把普通 WATCH 的 HDC 直连方法套到 GT4。
- [OpenHarmony 3.2 Release](https://github.com/openharmony/docs/blob/master/en/release-notes/OpenHarmony-v3.2-release.md)：本工作区采用 macOS ARM64 SDK 3.2.11.9 的 JS 与 toolchains 组件，保留 legacy lite 编译器。
- SDK 下载地址：`https://repo.huaweicloud.com/openharmony/os/3.2-Release/L2-SDK-MAC-M1-PUBLIC.tar.gz`。SHA-256 已与官方同路径 `.sha256` 文件核对。
- Node 16.20.2 从 `nodejs.org/dist/v16.20.2/` 下载，并与该目录 `SHASUMS256.txt` 核对。
- [Frida iOS](https://frida.re/docs/ios/)：复用手机已有 Frida 服务，脚本由电脑传入进程内存。主机客户端固定为与手机服务一致的 17.23.2。

## 公开实作

- [HuaSideload](https://github.com/burak4arslan/huawei-watch-sideload-ios)，本工作区固定来源提交 `c256b8acb95d013e9491b4da05ffeed1f59aeec9`。参考其 `tools/build-watch-app.sh`、`check-watch-bin.py` 以及 `HuaweiFeatures.swift` / `HuaweiSession.swift` 的 Lite 包格式和安装服务。作者的实测机型是 GT3 SE；GT4 结果以本工作区的真机记录为准。
- [GT4 签名实作指南](https://github.com/megaacheyounes/harmonyos-dev-guide/blob/master/signing_config.md)：参考其调试证书、设备注册与 Profile 流程。控制台界面已发生变化，实际操作另行记录。
- [Wear Engine 表端示例](https://github.com/Explore-In-HMOS/sportwatch-wear-engine-lite-wearable-to-mobile)：供后续扩展手机通信参考。本次计数器不依赖 Wear Engine、fetch 或手机数据。

## 本机既有工程

只读参考本机既有 CrescentRelay 工程的协议与文件传输实现，用于核对已安装 iPhone 应用的字段布局、IV 计数、文件协商、续传偏移和位图约定。未修改该工程或重新安装 iPhone 应用。手机工程不包含在本仓库；安装适配器依赖当时已有的进程和布局，不能作为任意 iPhone 的通用安装器。

## 许可

HuaSideload 和经其转译的 Gadgetbridge 协议代码采用 AGPL-3.0；上游完整许可保存在 `tools/huawei-watch-sideload-ios/LICENSE`。`scripts/build-lite.sh` 是该项目构建脚本的改编，`phone-bridge.js` 与 `watch-channel.py` 包含相同协议的移植实现。仓库源码按 AGPL-3.0-or-later 提供，许可正文见根目录 `LICENSE`，来源说明见 `THIRD_PARTY_NOTICES.md`。应用计数逻辑为本次新增。

## 平台版本说明

GT4 的发行规格和当前固件报告可能不同。本次真实安装服务返回 API 12、设备类型 38、466×466，而不是用机型名推断当前 API。计数器只使用 API 6 起的基础组件，源码 `compatible/target` 均为 6；以 API 9 SDK 保留的 legacy lite 工具构建。能否运行以实际安装与打开结果为准。
