# 本次开发与安装实录

日期：2026-11-13。电脑为 macOS ARM64。iPhone 使用用户已有的 SSH、Frida 17.23.2 和 CrescentRelay，目标地址保存在本地配置中，不随仓库分发。

## 1. 创建与构建

应用位于 `examples/gt4-counter/entry/src/main/`，`config.json` 使用 `liteWearable`。页面为基础 `div` 和 `text`，点击事件直接绑定 `increment`、`reset`，不引入手机通信。

构建链为：

```text
JS / HML / CSS
  → ace-loader / webpack.lite
  → restool（资源 ID 与应用配置）
  → haptobin_tool（legacy lite 二进制包）
  → hap-sign-tool sign-app -inForm bin
  → 签名 .bin
```

使用 OpenHarmony 3.2.11.9 SDK 中保留的 legacy lite 工具，并固定 Node 16.20.2。SDK 和 Node 下载均校验摘要。工具本身、npm 依赖、Java 临时目录、npm 与 Python 缓存都在工作区内。

两种图标分别为 114×114 和 41×41。最终包需要 `icon.bin`、`icon_small.bin` 以及由 `restool` 生成的 `iconId`、`labelId`。仅有 PNG 或手工猜资源 ID 不足以完成这条构建链。

本机 `rsync -R` 复制资源时出现 `skipping directory .`，本地改编的构建脚本已改用 Python 按相对路径复制，重复构建通过。

## 2. 华为控制台签名配置

所有私有材料保存在 `.local/signing/`，私钥不离开电脑。

1. 本地生成 ECC P-256 私钥与 CSR。密钥别名为 `gt4counter`，密码随机生成并存储在权限 600 的文件中。
2. 在已实名认证的华为开发者账号中创建调试证书 `GT4 Counter Debug 20261113`，上传本地 CSR。下载证书链的第三个证书是匹配本地公钥的叶子证书，有效期至 2027-11-13。
3. 首次沿用公开 iOS 项目的做法，把 `SecurityNegotiation` 响应的 64 位身份当成调试 UDID，新增了 `GT4 Counter Watch 20261113`。但该身份与账号原有 `gt4` 完全不同；用户随后确认原有 `gt4` 就是当前手表。因此后续签名改用原有记录的调试 UDID，认证身份单独保存，不再混用。原设备未修改。
4. 在新版控制台创建 `GT4 Counter`，包名 `com.example.gt4counter`，APP ID 由控制台生成并保留在本地。根据华为新版创建说明，先从“手表”入口创建，再到应用信息修改支持设备，仅保留“运动手表”。不能保留默认智能手表或手机类型。
5. 为该应用选择本次证书及用户确认的原有 `gt4` 设备，生成 Debug Profile，保存到 `profiles/com.example.gt4counter.p7b`。首次仅包含认证身份的 Profile 单独保留用于失败记录。
6. 构建签名包，核对包名、证书、Profile 和设备 UDID 一致。

新版入口说明：[华为创建应用文档](https://developer.huawei.com/consumer/cn/doc/App/agc-help-create-app-0000002247955506/)。

本次浏览器上传工具的工作区根路径配置不匹配，拒绝读取 CSR。用户在已有上传弹窗中选择了工作区内 CSR，后续操作继续自动完成。证书下载使用页面实际生成的文件链接直接保存工作区，没有让浏览器写默认下载目录。

首次签名包已完成文件传输，手表返回文件有效性 1，但安装进度到 10% 后返回 103。补充诊断确认 PKCS#7 数学签名及 4096 字节分块摘要正确，通用状态包没有附加错误字段。调试 UDID 与认证身份混用成为经用户设备记录确认的具体差异，随后按正确记录重新签名。这条经验不能从“64 位十六进制”或某个客户端变量名直接推断。

## 3. iPhone 与手表通道

最初使用了错误的手机地址，更正后 SSH 连通。所有 SSH 使用工作区独立 `known_hosts`，不修改系统 SSH 配置。

手机已有的 Frida 服务通过回环地址 `127.0.0.1:27042` 提供服务，电脑用 SSH 转发至 `127.0.0.1:27043`。客户端与手机服务统一为 17.23.2。手机解锁并打开 CrescentRelay 后，可稳定附加。后续按实际 PID 附加，避免按进程名附加时的超时。

内存适配器复用已配对应用的蓝牙连接和当前会话，使用原会话 IV 计数进行加密；不重新配对，不导出配对密钥，不保存会话密钥，不替换应用。文件和安装服务限定为 SID `0x28` 与 `0x2A`。传输期间占用现有应用的内存忙碌标志，结束后释放。

实际 `0x2A/0x06` 参数响应为：

| 字段 | 实测值 |
|---|---|
| 设备类型 | 38，运动手表 |
| API | 12 |
| OS 字符串 | OpenHarmony 1.0.1 |
| 屏幕 | 466×466 |
| 单个传输帧上限 | 本适配器保守使用 182 字节 |

请求应用参数和应用列表时必须带空 `0x81` 容器；直接发送空消息得到的空结果不能作为有效平台信息。参数及列表读回保存在本地 `artifacts/watch-installer-inspection.json`，不随仓库上传。

## 4. 安装与验收标准

安装包先在电脑检查签名及资源结构，再以文件类型 6、文件名 `com.example.gt4counter_INSTALL` 发起传输。按手表请求应答摘要、协商参数和数据窗口。续传摘要覆盖有效偏移之后的内容；EOF 偏移归零后覆盖整个文件。只按手表协商结果选择文件数据是否加密。

安装脚本需要同时取得：文件有效性结果 1、安装状态 102、应用列表中本包名的读回结果。状态 103 表示安装失败。文件写完、蓝牙 API 返回和传输进度到 100% 均不替代安装结果。

最后需要在真实手表打开应用，验证初值 0、三次点击显示 3、重置为 0、再次点击显示 1。最终状态与传输记录分别见 `artifacts/status.json`、`artifacts/install-result.json`。这些原始运行记录包含本机状态，仅保留在本地，不随仓库上传。

## 最终结果

改用用户确认的原有 `gt4` 调试 UDID 后，新 Profile 为 `GT4 Counter Debug Verified GT4 20261113`（控制台 ID 不随仓库分发），仅包含该设备。源码、应用包名和签名证书保持一致。重新签名并传输后，手表返回文件有效性 1，安装进度依次通过 10、50、60、70、80、90，最终状态 102。随后应用列表读回 `com.example.gt4counter` / `GT4 Counter` / `1.0.0`。

用户在真实手表打开应用，并确认页面、加一与归零交互全部通过。

这次最关键的修正是：已有客户端中名为 `watchUDID` 的字段实际来自认证协商，不能仅凭变量名或 64 位十六进制格式当作调试 UDID。首次两次安装使用该身份均在 10% 返回 103；换为用户确认的调试 UDID 后完整通过。

SDK 的 `verify-app` 在本次 `.bin` 上进入 ZIP 验证分支并失败，不能用它的 HAP/ZIP 结果判断 Lite 二进制。工作区提供 `scripts/verify-bin.py`，独立检查包内 CMS 签名、4096 字节分块聚合摘要、资源结构和所嵌 Profile；真实手表的安装与运行结果另作最终验收。

## 调试环境收尾

用户要求结束后关闭手机上的调试工具。本次已完成以下操作，并再次检查进程列表确认没有自动恢复：

- 卸载本次 Frida 内存适配器，恢复蓝牙传输忙碌标志及临时屏幕休眠状态。
- 停止本次启动的手机 `frida-server`；没有运行中的 Frida、debugserver 或 LLDB。
- 关闭电脑上 `127.0.0.1:27043` 的 SSH 调试转发。
- 在 iPhone 远控界面点击断开，界面显示已断开。
- 发现 `iphone-stream` 被原有 supervisor 自动拉起后，执行 `launchctl bootout system/local.trollvnc.lite` 停止当前远控服务注册及其守护进程。再次查询未发现远控进程或该服务注册。

没有向 iPhone 上传安装包、脚本、SDK、缓存或本次日志。没有删除原有手机工具文件、修改其持久配置或卸载越狱环境；原有 SSH 服务保留。本次运行记录仅在电脑本目录的 `.local/logs/` 和 `artifacts/`。收尾结果保存在 `artifacts/cleanup-result.json`。

## 重复执行入口

```bash
# 已有环境检查或恢复，文件均在当前目录
bash scripts/setup.sh

# 不签名的编译检查
bash scripts/build.sh --unsigned

# 校验正确的设备 Profile 并生成签名包
bash scripts/build.sh --signed

# 如需再次连接，分别启动手机现有 Frida 和本地转发
bash scripts/connect-iphone.sh server
bash scripts/connect-iphone.sh tunnel

# 只读核对手表与应用列表
bash scripts/watch.sh

# 首次安装；同包名已存在时脚本停止，不自动覆盖
bash scripts/watch.sh --install 'artifacts/GT4 Counter.bin'
```

本次已安装 `1.0.0`，后续修改和升级需要先核对版本号及升级策略。不要把认证身份重新写入 `watch-udid.txt`，也不要使用 `GT4 Counter-unverified-identity.bin`；后者仅保留为失败证据。
