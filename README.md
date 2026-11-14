# WATCH GT 4：开发、安装与鼠标转发示例

仓库现包含两个示例：

- [GT4 Counter](examples/gt4-counter/)：离线计数器，下文保留其完整签名与安装流程。
- [GT4 AirPointer 1.2.6](examples/gt4-airpointer/)：GT4 → BLE → iPhone → Mac 鼠标转发，包含表端、内存适配器、接收器、测试与实测记录。后续网络探测版本不在此快照中。

这是一个已在 **HUAWEI WATCH GT 4 真机运行**的 Lite Wearable 离线计数器，也是一次完整开发、签名、安装过程的记录。点击 `+1` 计数，`Reset` 归零，上限 999；退出后不保留计数，不申请网络或健康权限。

2026-11-13 的实际结果：签名包通过手表校验，安装状态返回 **102**，应用列表读回 `GT4 Counter / 1.0.0`，用户在手表打开后确认页面、加一和归零均正常。调试结束后，手机 Frida、远控及其守护进程、本次电脑 SSH 转发均已停止。

仓库包含表端源码、隔离构建脚本、签名校验和本次使用的 iPhone 安装适配器。**编译可独立复现；本次 iPhone 安装方式依赖手机原有的 CrescentRelay 和 Frida，不是普通 iPhone 装好运动健康就能直接运行的通用安装器。** CrescentRelay 手机工程与安装包不在本仓库，其内部字段布局变化后需要重新适配。

## 整条链路

```text
本地 JS/HML/CSS 页面 ──→ legacy lite 编译器 ──→ 未签名 .bin
本地私钥 → CSR → 华为网页申请 Debug 证书 ─────────────────┐
华为网页创建应用 + 注册真实手表调试 UDID → Debug Profile ──┤
                                                         ↓
                         校验包名/公钥/设备绑定 → 签名 .bin
                                                         ↓
电脑 SSH 转发 → iPhone 现有配对会话 → 蓝牙文件传输 → 手表安装
                                                         ↓
                         安装结果 + 列表读回 + 真机点击验收
```

官方把应用包称为 HAP。本次 legacy lite 安装通道实际接收经 `haptobin` 转换并以 `-inForm bin` 签名的二进制包。**不能把 ZIP/HAP 改名为 `.bin` 代替转换。** [官方 Lite Wearable 指南](https://developer.huawei.com/consumer/cn/doc/lite-wearable-guides/lite-wearable-bpta-guide/)介绍了 DevEco Studio、运动健康和应用调测助手的官方路线；本次实际走的是下面的命令行构建与已有 iPhone 会话安装路线。

## 1. 环境与目录

| 项目 | 本次环境 / 前置条件 |
| --- | --- |
| 电脑 | macOS ARM64，已有 Java 17、`/usr/bin/python3`、Git、curl、OpenSSL、zip/unzip |
| 编译器 | OpenHarmony 3.2.11.9 / API 9 SDK 中的 legacy lite 工具；Node 16.20.2 |
| 应用 | JS + HML + CSS，`liteWearable`，兼容/目标 API 6；本次固件实际报告 API 12、466×466 |
| 账号 | 已实名认证、能够申请调试证书和 Profile 的华为开发者账号 |
| 设备 | 当前手表的真实调试 UDID，不是认证会话身份或蓝牙地址 |
| 本次安装手机 | 已与手表配对，已有 root SSH、Frida server 17.23.2、匹配适配器的 CrescentRelay；解锁并保持应用前台 |

所有下载、SDK、依赖、临时文件、缓存、签名材料和日志都在仓库目录内。脚本只读使用已有系统工具，不全局安装，不重定义 `HOME`，不往 iPhone 写入安装包、脚本或日志。

```text
examples/
  gt4-counter/        本仓库跟踪的演示源码；build/ 不入 Git
  gt4-airpointer/     已验证的 1.2.6 BLE 鼠标转发源码快照
app/                  后续自行开发的应用，整个目录不入 Git
  我的应用A/          每个应用以应用名为目录
  我的应用B/
scripts/              环境、编译、签名检查、连接与安装脚本
docs/                 安装实录、能力列表、来源说明
tools/                SDK、Node、依赖、固定提交的参考工程（忽略）
artifacts/            编译产物和运行报告（除占位文件外忽略）
.local/               缓存、临时文件、SSH known_hosts、本地配置和签名材料（忽略）
AGENTS.md             工作区边界和目录约定
LICENSE               AGPL-3.0 许可正文
THIRD_PARTY_NOTICES.md 来源及许可说明
```

`app/` 专供后续开发，新增任意 `app/应用名/` 都会被 Git 忽略。明确发布的源码放在 `examples/`；默认根构建、校验和安装脚本仍指向 Counter，AirPointer 使用其目录内脚本。开发新应用可先复制示例到 `app/应用名/`，再调整包名、名称、版本及签名配置；脚本不会自动发现或部署新应用。

进入克隆后的仓库目录，后续命令均在该目录执行：

```bash
git clone https://github.com/Just1ceP4rtn3r/huawei-gt4-application.git
cd huawei-gt4-application
bash scripts/setup.sh
bash scripts/build.sh --unsigned
```

`setup.sh` 下载并校验 SDK 与 Node 的 SHA-256，安装本地 npm/Python 依赖，并检出固定的 HuaSideload 参考提交。首次下载需要网络和数 GB 磁盘空间。平台检查只接受 macOS ARM64，其他平台尚未复现。系统 Java 等前置工具需事先可用，脚本不负责全局安装。

未签名输出为 `artifacts/GT4 Counter-unsigned.bin`，用于验证编译，不可安装。构建链为 `ace-loader/webpack.lite → restool → haptobin_tool`，编译页面、图标、配置和资源 ID，随后才进入签名。

## 2. 准备本地私钥和 CSR

```bash
source scripts/env.sh
/usr/bin/python3 scripts/create-signing.py
```

脚本保留已有密钥，不会每次重新生成。首次生成 ECC P-256 密钥、随机密码、CSR、默认签名配置和 Profile 目录：

```text
.local/signing/
  gt4counter.p12          私钥容器，留在电脑
  password.txt           随机密码，权限 600
  gt4counter.csr          上传华为网页的证书申请
  signing.env            签名文件名与别名配置
  profiles/              下一步保存 Profile
```

妥善备份私钥和密码，它们不进入 Git。后面华为签发的证书必须对应这份 CSR；不要下载一个已有证书就假定它匹配当前私钥。

## 3. 在华为网页获取证书、设备记录和 Profile

用已登录账号进入 [华为开发者联盟](https://developer.huawei.com/consumer/cn/) / AppGallery Connect。入口名称可能随控制台版本变化，按证书、设备、应用和 Profile 这四类对象核对。完整实录见 [INSTALLATION.md](docs/INSTALLATION.md)。

### 3.1 申请调试证书

1. 进入证书管理，新增 **调试证书 / Debug**，填入易识别的证书名称。
2. 上传 `.local/signing/gt4counter.csr`，提交申请。
3. 下载签发证书链，保存为 `.local/signing/gt4counter-debug.cer`。下载时选择仓库内路径，避免写入系统默认下载目录。
4. 保留完整证书链。本次下载文件含多个 PEM 证书，校验脚本会寻找与 CSR 公钥匹配的叶子证书，不依赖固定排序。

本次浏览器工具曾因允许上传的目录配置不匹配而拒绝 CSR。最后由用户在网页上传弹窗中选择该文件，之后继续完成申请。这是浏览器工具限制，无需重新生成密钥，也不要搬到工作区外绕过限制。

### 3.2 获取并注册正确的手表调试 UDID

1. 若账号已有当前手表记录，先确认它确实属于当前手表，沿用其调试 UDID。
2. 若没有记录，可按 [GT4 签名实作指南](https://github.com/megaacheyounes/harmonyos-dev-guide/blob/master/signing_config.md)通过 DevEco Assistant 获取调试 UDID，再在开发者控制台的设备管理中注册运动手表。本次没有重新复现这条获取路径。
3. 将确认后的调试 UDID 保存为 `.local/signing/watch-udid.txt`，文件仅含当前设备的一行值，不提交 Git。

**本次最重要的失败经验：认证身份不等于调试 UDID。** 现有手机应用中名为 `watchUDID` 的字段来自 `SecurityNegotiation`，也是 64 位身份，但与已注册真实设备不同。首次两次使用它生成 Profile，传输校验通过后均在安装 10% 返回 103。用户确认账号原有设备就是当前 GT4 后，改用那条设备记录重新签名，安装完整通过。

`bash scripts/watch.sh --auth-identity` 只保存认证身份供诊断，不获取真实调试 UDID，也不会覆盖 `watch-udid.txt`。

### 3.3 创建应用

1. 在 AppGallery Connect 创建应用，名称可用 `GT4 Counter`。
2. 包名填写 **`com.example.gt4counter`**，必须与 `examples/gt4-counter/entry/src/main/config.json` 一致。
3. 本次新版控制台先从“手表”入口创建，再到应用信息修改支持设备，仅保留 **运动手表**，不要误选普通智能手表。入口变化可对照 [华为创建应用说明](https://developer.huawei.com/consumer/cn/doc/App/agc-help-create-app-0000002247955506/)。
4. APP ID 由控制台生成，本项目没有把具体账号的 APP ID 写进源码。

若账号已占用示例包名，请先选择自己的唯一包名，并同步修改配置及脚本中 `com.example.gt4counter` 的引用，包括 Profile 文件名；用 `rg 'com.example.gt4counter' examples scripts` 检查，不要只改网页。

### 3.4 生成 Debug Profile

在 Profile 管理新增 **Debug** 配置，选择刚创建的应用、与本地 CSR 匹配的证书，以及确认属于当前手表的调试设备。下载后保存为：

```text
.local/signing/profiles/com.example.gt4counter.p7b
```

最终本地应多出 `gt4counter-debug.cer`、`watch-udid.txt` 和上述 `.p7b`。`signing.env` 默认引用 `gt4counter` 别名、`gt4counter.p12`、`gt4counter-debug.cer`、`password.txt`，无需把密码直接写入配置。

## 4. 校验材料并编译签名包

```bash
bash scripts/build.sh --signed
```

脚本先检查 Profile CMS 数学签名、Debug 类型、包名、设备 UDID、证书与 CSR 的公钥匹配关系，再构建并调用 `hap-sign-tool sign-app -inForm bin`。CMS 检查使用 `-noverify`，不等于额外完成华为 CA 信任链验证；最终授权与设备兼容性仍由手表验证。

输出：

```text
artifacts/GT4 Counter.bin          签名安装包
artifacts/signing-validation.json  签名材料一致性检查
artifacts/package-validation.json 包内 CMS、分块摘要、资源及 Profile 检查
```

`verify-bin.py` 核对嵌入 Profile、4096 字节分块聚合摘要和 CMS 签名。本次 SDK 自带 `verify-app` 对 `.bin` 走了 ZIP 验证分支，报 ZIP 结构错误，因此不能单凭该结果判定 Lite 二进制损坏。所有产物、报告和设备绑定材料均留在本地。

## 5. 连接本次使用的 iPhone 安装通道

**只在前置条件满足时执行本节。** `phone-bridge.js` 寻找 `CrescentRelay.WatchTransport` 并读取其 Swift 字段布局，复用已经建立的蓝牙连接、密钥和 IV 计数，不建立全新配对会话。手机工程未包含在这里，进程或字段不匹配时不能直接使用；其他手机客户端需要单独适配，不能只修改进程名。

先设置实际手机地址，不在仓库源码保存个人 IP：

```bash
export GT4_IPHONE_HOST=你的手机局域网IP
source scripts/env.sh
```

也可以在被 Git 忽略的 `.local/iphone.env` 写入 `GT4_IPHONE_HOST=你的手机局域网IP`，供多个终端复用。SSH 要求已有可用密钥登录，脚本不收集或保存 SSH 密码。

首次建立工作区独立的主机信任记录，核对手机 SSH 指纹后接受提示：

```bash
ssh -F /dev/null \
  -o UserKnownHostsFile="$PWD/.local/ssh/known_hosts" \
  -o StrictHostKeyChecking=ask "root@$GT4_IPHONE_HOST" \
  'HISTFILE=/dev/null; export HISTFILE; true'
```

手机解锁，打开 CrescentRelay，确认 GT4 已连接并保持前台。主机客户端固定为 Frida 17.23.2，必须与手机现有 server 匹配；本仓库不向手机安装 Frida。

若服务未运行，在一个终端启动手机**已有** server，仅绑定手机回环地址：

```bash
bash scripts/connect-iphone.sh server
```

第二个终端启动转发：

```bash
bash scripts/connect-iphone.sh tunnel
```

第三个终端查询参数和应用列表：

```bash
bash scripts/watch.sh
```

转发关系为电脑 `127.0.0.1:27043 → SSH → 手机 127.0.0.1:27042`。不要重复启动同端口服务。查询结果写入本地 `artifacts/watch-installer-inspection.json`，本次返回设备类型 38、API 12、466×466。适配器在手机进程内存运行，会话密钥不写入电脑或手机文件。

普通 iPhone 用户可另行评估 [HuaSideload](https://github.com/burak4arslan/huawei-watch-sideload-ios) 的原生客户端，它是本项目构建及协议参考之一。本次未用它替换现有手机应用，不能据此声称已复现其完整安装流程。官方 Android / 华为手机路线应按官方指南准备 DevEco Assistant 和相应 HAP 工程，不能把本节 `.bin` 命令直接套过去。

## 6. 安装到手表并验收

```bash
bash scripts/watch.sh --install 'artifacts/GT4 Counter.bin'
```

安装前检查包格式、资源、包名与嵌入的 Profile。对**同包名已安装**的情况脚本直接停止，不自动删除或覆盖已有应用；更新版本需要另行制定升级策略。

安装使用文件服务 `0x28` 和应用服务 `0x2A`，以文件类型 6、名称 `com.example.gt4counter_INSTALL` 发起传输，按手表请求处理摘要、续传偏移和数据窗口；仅在手表协商允许时使用明文文件数据，控制消息仍按会话加密。

完成标准必须同时满足：

1. 文件有效性返回 **1**。
2. 安装最终状态 **102**，而不是失败状态 103。
3. 应用列表读回包名 `com.example.gt4counter`、名称和版本。
4. 在手表应用列表打开 `GT4 Counter`，初值 0，点三次 `+1` 显示 3，点 `Reset` 显示 0，再点一次显示 1。

前三项记录在本地 `artifacts/install-result.json`，第四项需要实际打开手表操作。本次四项均已完成。蓝牙写入成功、传输到 100% 或文件校验通过，单独都不能代表安装成功。

## 7. 结束调试

安装脚本正常退出会释放内存中的传输占用标志、恢复临时屏幕休眠状态并 detach。接着关闭本次启动的 server 和 SSH 隧道终端；检查手机是否仍有本次 `frida-server` 进程，若有则通过 `scripts/ssh.sh` 停止**核对后的该进程 PID**。不要只关闭电脑窗口就假定手机服务已经退出。

若使用了额外远控，也要断开并检查是否被守护进程重新拉起。本次发现原有 `iphone-stream` supervisor 自动重启远控，停止对应服务后复查，确认 Frida、debugserver、LLDB、远控和本次转发均已关闭。具体设备的服务名见 [收尾实录](docs/INSTALLATION.md#调试环境收尾)，不应照搬到不相同的手机环境。

本次没有删除原有工具文件、改变持久越狱配置或停止原有 SSH 服务，没有在手机落地安装包、脚本、日志。GitHub 整理阶段未重新开启手机调试。

## 常见问题与经验

| 现象 | 本次定位及处理 |
| --- | --- |
| 文件校验通过，10% 后返回 103 | 本次是 Profile 绑定了认证身份；改用已确认的真实调试 UDID 后成功。103 本身不能唯一定位所有安装失败原因 |
| 附加超时或找不到进程 | 解锁手机，保持匹配的 CrescentRelay 前台；按枚举到的 PID 附加，核对 Frida 版本 |
| 参数/应用列表响应为空 | 请求需要空 `0x81` 容器；脚本已处理，不能把空回复当平台能力 |
| 图标或资源无效 | 需要 114×114 与 41×41 图标，经 restool/haptobin 生成资源 ID 与 `.bin` 资源，不能只放 PNG |
| macOS rsync 复制漏资源 | 构建脚本已改为 Python 按相对路径复制资源 |
| 同包名已存在 | 安装脚本主动停止，当前已安装的 1.0.0 不会被默认覆盖 |
| iPhone 配对时无法 fetch | GT5 及更早运动表有官方限制，详见能力文档；此计数器完全离线 |

## 文档、许可与仓库边界

- [INSTALLATION.md](docs/INSTALLATION.md)：真实失败、修正、成功与调试收尾记录。
- [CAPABILITIES.md](docs/CAPABILITIES.md)：UI、存储、传感器、定位、通信等能力及验证状态。
- [SOURCES.md](docs/SOURCES.md)：官方资料、固定上游提交和技术选择。
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)：代码来源及第三方许可说明。

仓库按 **AGPL-3.0-or-later** 提供源码。SDK、依赖和上游工程由 `setup.sh` 下载，遵循各自许可。仓库不包含私钥、密码、证书、Profile、真实 UDID、手机地址、签名包、应用列表或原始运行日志，它们仍只存在于原工作区。调试签名包绑定具体设备，克隆者需要申请自己的签名材料。
