# 验证记录

本次开发日期：2026-11-13。只对本项目实际执行的步骤标记完成，原计数器的真机结果不能迁移到新应用。

## 已完成

- 按用户要求复用原包名 `com.example.gt4counter`，版本 `1.1.0`；全部项目位于被 Git 忽略的 `examples/gt4-airpointer/`。
- legacy lite JS/HML/CSS、restool、haptobin 与签名包构建；复用原 Profile，CMS、分块摘要和设备绑定检查通过。
- macOS ARM64 Swift 原生鼠标接收器编译。
- Frida iPhone 内存适配器 bundle 构建；没有为此启动手机服务或附加手机进程。
- 静止偏置校准、死区、移动方向、滚动、加速度倾斜回退、采样间隔和无效数值检查。
- 校准移动拒绝、校准超时、默认暂停、按钮过期、可选双敲合成数据检查。
- 单个在途发送、有界待发送帧、销毁后的迟到回调处理。
- P2P 路由与精确 appverify 公钥身份匹配、错误指纹、重复/截断 TLV、ACK 和状态帧检查。
- 模拟 native 回调驱动真实页面逻辑，检查校准、页面隐藏退订、恢复保持暂停、迟到亮屏回调恢复。
- 真实 Mac 可执行文件 dry-run 管道测试：重复序号/按钮去重、拖拽切换、暂停释放，以及 stdin 保持打开时的真实看门狗定时器。
- 编译和离线测试未请求 macOS 辅助功能授权、未发送 OS 鼠标事件、未重开手机 Frida/远控。

重新执行：`bash examples/gt4-airpointer/scripts/build.sh --unsigned`。本地最新构建状态与摘要见项目 `build/status.json`；每次构建会把真机状态明确保留为 not_run，真机结果另行人工记录。

## 当前真机验收状态

| 步骤 | 操作及通过标准 | 当前状态 |
| --- | --- | --- |
| 签名 | 按用户要求复用原证书、Profile 和真实 GT4 UDID；权限字段补全，CMS 与摘要校验通过 | 已完成 |
| 安装 | 文件有效性 1、最终安装状态 102、应用列表读回 GT4 AirPointer / 1.1.4；安装前列表已无计数器 | 已完成 |
| UI | 欢迎页/控制页启动、Connect 可见已由用户确认；其他交互继续验收 | 部分通过 |
| 传感器 | 用户确认 A/G 计数增长；实际数值、频率、单位和轴向仍待消息回路采样 | 回调通过，数值待测 |
| 预览 | 静止校准后漂移小，主动 Resume 后预览随手腕变化；Pause 和切换模式立即停止 | 未执行 |
| P2P | 手机到表探测获202；表到手机数据尚未通过，1.1.4继续验证注册/探测 | 未通过 |
| 鼠标 | 主动授权辅助功能并使用 --enable；分别验证左右移动、上下移动、灵敏度、点击和滚动 | 未执行 |
| 拖拽/失联 | 开始拖拽，Pause/退后台/断开 relay/断开蓝牙后释放；重新进入保持暂停，积压点击不重放 | 未执行 |
| 敲击 | 分别测走路、转腕、碰桌、单敲和双敲，统计误触；不达标保持关闭 | 未执行 |
| 收尾 | 停 relay、清理本次 Frida server 和 SSH 转发；无远控、无手机新文件/日志 | 已关闭并复查：无 Frida/远控/本地转发 |

## 当前外部前置

- 本次已按用户要求复用旧包名与原 Profile，无需新 Profile。原计数器源码和旧签名包保留。
- 当前 iPhone 配对客户端不是通用 Wear Engine SDK 客户端。路由声明和 native 接收器能否获得该固件的表端消息，需要一次独立真机回路验证。
- 陀螺仪权限在部分版本的文档中属于系统权限；静态声明不保证获批，应看实际订阅结果，并测试倾斜回退。

若传感器接口被固件拒绝或 P2P 路由不能连通，应记录原始错误码并调整接入方案，不将离线结果改写为真机成功。


## 2026-11-14 安装实录

1. 初始尝试按 1.0.0 升级，脚本发现设备列表中已没有原包名，保护停止，未发包；核对列表后按首次安装。
2. 第一包只有权限 name，文件有效性为 1，但安装进度 10 → 50 → 103。原始结果保存在 `build/attempts/01-minimal-permissions.json`。
3. 公开 Lite 解析器 `SetReqPermission` 强制 name、reason、usedScene.when；其中 when 仅接受 inuse/always。补齐字段并加入 reason 资源，保持相同证书、Profile、包名和版本后重签。
4. 第二包文件有效性 1，安装进度 10 → 50 → 60 → 70 → 80 → 90 → 102；应用列表读回 `com.example.gt4counter / GT4 AirPointer / 1.1.0`。结果见 `build/install-result.json`。
5. 本机 CoreGraphics 事件投递权限只读检查为 allowed。尚未因此发送鼠标事件，先运行 dry-run 等待手表实测。

依据：[权限字段解析](https://github.com/openharmony/bundlemanager_bundle_framework_lite/blob/master/services/bundlemgr_lite/src/gt_bundle_parser.cpp#L983)、[安装阶段源码](https://github.com/openharmony/bundlemanager_bundle_framework_lite/blob/master/services/bundlemgr_lite/src/gt_bundle_installer.cpp#L241)。源码阶段映射只作排查依据，最终安装成功另有真实设备结果。


## 1.1.0 启动黑屏与 1.1.1 修复

用户确认点击应用图标即黑屏，没有欢迎页。因此 1.1.0 的 UI 验收失败，安装成功不代表运行成功。

发现项目根 package.json 的 type=module 被 webpack 用于判断表端 JS；Babel 转换为 CommonJS 后，产物仍按严格 ESM 处理，app.js 残留电脑 loader 路径的 require，页面残留外部 @babel/runtime require 和未绑定 exports。表端不存在 Node require，无法启动。

在 watch/package.json 明确 type=commonjs，把表端编译语义与 Node 测试隔离。新增 compiled-runtime.test.mjs，直接执行最终 app.js、欢迎页和控制页，外部 require 一律报错，检查 ViewModel、渲染、路由和 native 生命周期。1.1.1 修复包通过这些检查，另待实际打开确认。


## 1.1.2 圆屏布局修复

用户在 1.1.1 已能进入控制页，看到 Mac not confirmed / Preview only，确认启动黑屏修复。但找不到 Options，故未启动消息路由。控制页主容器原来未设置显式高度，底部控件存在被裁切问题。1.1.2 固定主容器高度并缩小预览区，将 Connect 提升到主页面顶部；已按源版本 1.1.1 升级并由设备读回 1.1.2。布局和传感器继续验收。


## 传感器与消息路由初测

用户确认 1.1.2 控制页 A/G 计数持续增长，因此两个 native 传感器回调已在真机触发；尚未取得原始数值或运动精度测量。点主页面 Connect 后显示 Link timeout，Mac 未收到指针帧。手机向该应用发送一次 P2P ping，真实手表应答 202，说明目标包存在且手机到表的探测通路有效，不等于数据通道已通。

核对公开实际源码后，发现原接收器把表端 P2P 身份错误地当成证书 SHA-256。Lite appverify GetAppid 使用包名与开发者证书未压缩 EC 公钥点的 Base64 拼接。已修正为从匹配 CSR 的真实叶子证书公钥导出身份，仍严格校验包名和身份，不放宽到任意来源。

1.1.3 恢复参考实现的 Wear Engine sdkVersion=3 版本协商，再依据版本选择 native wearengine 或 FeatureAbility；显示 W版本/API来源，native send 超时预算改为5秒。该初始化是最具体的兼容差异，是否解决当前发送超时仍由设备结果确认。

参考：[WatchAppCatalog 的 GetAppid](https://github.com/burak4arslan/huawei-watch-sideload-ios/blob/c256b8acb95d013e9491b4da05ffeed1f59aeec9/HuaSideload/WatchAppCatalog.swift)、[Lite bridge 版本协商](https://github.com/burak4arslan/huawei-watch-sideload-ios/blob/c256b8acb95d013e9491b4da05ffeed1f59aeec9/watch-apps/sample/entry/src/main/js/default/common/bridge.js)。


## 1.1.4 接收注册与断线恢复

W402 已由真实设备返回，用户看到 WE Send failed。与官方5.0.2.306 JS SDK逐项核对，发送参数确为字符串消息；补充unsubscribe/subscribe注册确认，先等待isRegister或空注册回调，再探测手机路由并开始发送。保留native失败第一实参并在预览区显示，以免丢掉错误原因。

同时修正探测应答方向：手机对手表的探测返回205，手表对手机探测返回202；数据接收仍为207。消息体增加900字符预算，超出时去掉诊断快照而保留指针/按键。

手机蓝牙会话曾重建，旧内存适配器按generation保护退出。之后本地SSH转发进程也退出，造成Frida不可达；重建转发并通过一次纯内存ping确认可附加后继续安装，不将无监听端口误认为手表应用错误。


## 本轮结束状态（2026-11-14）

- 手表实际安装版本为 1.1.4，设备安装成功结果保留在 build/install-result.json。
- 页面和 A/G 增长已由用户确认；校准精度、完整 P2P 数据和真实鼠标控制尚未通过，不能按已完成交付。
- 手机端接收器曾卡在一次 Native 状态读取。为规避 RPC 与蓝牙 delegate 相互等待的风险，把其 valid 校验改为 generation/paired/channelReady 的纯内存读取，不在该路径调用 CoreBluetooth state getter；该修改还需下一轮真机压力测试。
- 终止并重新打开当前 CrescentRelay 进程以清除无响应调试上下文，随后手机上未观察到该应用进程重新运行；需在解锁后的手机界面手动打开。未重装手机应用、未重置手表或解除配对。
- 已停止手机 Frida server、本地 relay/鼠标 dry-run 子进程和 SSH 27043 转发。复查手机未发现 Frida、debugserver、LLDB、iphone-stream、trollvnc；本机 27043 无监听。原有 SSH 服务保留。
- 没有向手机上传本次脚本、包、缓存或日志，没有启用实际鼠标事件。收尾记录见 build/cleanup-result.json。

继续验证时按 README 启动现有 Frida/转发和 run-relay.sh；手机解锁、CrescentRelay 显示已连接且保持前台，手表重新打开 1.1.4 点 Connect。先确认 register/detect 的原始状态或 Mac dry-run，再做校准与 --enable 实际鼠标验收。


## 2026-11-14 继续验证（1.1.5）

1.1.4 实测收到手表发起的 kind=1 探测，源包名和目标路由匹配；用户确认失败文字为 WE Send failed empty callback。注册和探测阶段已走过，但没有任何 pointer 数据帧到达手机。

1.1.5 将自定义手机路由名改为手机实际 CFBundleIdentifier `local.gt4bridge.crescent`，与公开实现使用真实 Bundle ID 的方式一致；首次 Mac 回执前去掉诊断附加字段，只发送最小指针帧。保持原签名材料不变，真机安装102、列表读回1.1.5，正在等待这次对照测试。该改动的有效性尚未确认，不能认定原路由名就是根因。


## 实际探测路由不匹配（1.1.5）

真实日志显示源com.example.gt4counter、目标local.gt4airpointer.relay，p2pPackets=1但routeMatches=0。已核对1.1.5签名包内和源码的peerPackage为新名称、安装列表也读回1.1.5；故不能仅凭源码认定运行时Native路由已切换，也尚不能确定旧路由保留的内部原因。

直接失败链条已证实：接收器只认新名称，拒绝了实际旧名称探测，未发送ACK，导致detect超时。修复限定为兼容本项目两条明确已知路由，仍校验源包名及数据消息公钥身份；ACK和状态消息按实际收到的peerPackage原样反转。新增真实旧路由回归测试和ackSent/ackFailed计数，通过离线测试，等待真机复测。未再次重装手表，也未宣称数据通路已通过。


## 双向协议边界与官方SDK对照

实际旧/新手机路由兼容后，手表探测记录routeMatches=1、ackSent=1、ackFailed=0，但仍无pointer帧。另从手机向表端发送sequence=98、内容为非输入probe的短应用数据，收到手表207回执。该证据确认了反向应用数据路由及表端公钥身份，不能据此宣称表端发送API正常。

1.1.6 冻结手机传输/加密/匹配层，表端改用官网原始 Lite SDK 5.0.2.306的P2pClient/Message/Builder进行初始化、注册、探测和发送。vendor文件保留华为Apache-2.0版权，唯一SDK原文件适配是把静态native模块import改为SDK旧编译器兼容的runtime requireModule。compiled-runtime测试已执行实际打包后的官方SDK注册、探测和发送流程。该对照结果仍须真机确认，不预设它必然修复底层API失败。


## 1.1.6 异常与用户暂缓测试

官方SDK版本安装102并读回1.1.6。用户随后报告手表黑屏、疑似关机，未取得足以确认实际关机/重启及其原因的日志。电脑接收器只记录到配对会话变化，未收到指针数据；这不能独立证明重启原因。已停止全部测试，没有发送关机、重启、重置或解除配对指令。

用户之后能再次打开应用，显示W402 detecting phone，并要求稍后解决。此时电脑接收器与SSH转发已关闭，因此该等待状态不能用于新增根因判断。已复查：手机无Frida/debugserver/LLDB/iphone-stream/trollvnc，本机27043无监听。本轮从未启用真实鼠标事件。按用户要求暂缓，不继续修改应用或测试，后续优先排查黑屏异常及官方SDK初始化时机。

## 正式测试后的 206 与 1.1.7 诊断准备

用户明确要求启动正式测试后，以 `--enable` 启动 Mac 接收器，Accessibility 查询为 allowed。手机日志实际收到新目标路由的 kind=1 探测，routeMatches=1、ackSent=1、ackFailed=0；无 kind=2 指针帧。用户看到 send failed 206。receivedFrames=0，所以尚无实际鼠标事件成功证据。

为获取表端原生错误，1.1.7 新增有界内存日志、原生 API 回调观测、自定义 detect 分段导出和 Mac 重组器。官方 SDK 的 native import 改为本地 lazy facade，首次打开控制页不初始化 Wear Engine，直到 Connect 才加载；保留原 SDK 发送映射语义。原生发送首次失败立即关闭 sender，避免无效重复发送。

已完成：签名与结构校验；实际编译后 JS 在 VM 中执行欢迎页/控制页、懒初始化、正常发送及原生失败导出流程；用原生失败第二参数 987 验证日志在 SDK 映射成 206 前保留该参数；诊断 ping 路由/ACK/越界拒绝测试；Mac 完整重组、重复段及大小限制测试；原有传感器算法、生命周期、鼠标接收器和看门狗检查。以上均为离线检查，不能替代真机日志。

已停止此前 enable 接收器。1.1.7 使用原签名材料升级，后续诊断接收器使用 dry-run。安装、实际诊断分段与根因结论将在取得对应证据后补充；尚未把新通道标记为真机成功。

1.1.7 首次尝试在文件有效性1、进度101→10→50→60后返回103，结果保留在 `build/attempts/08-diagnostic-117-regexp-rejected.json`。签名和权限未改变。对照本地已保存的 OpenHarmony Lite BMS 源码，60之后、70之前是 JS→字节码转换阶段（GT4固件不保证与此源码完全一致）。直接使用 SDK 的 `bin/jerry --parse-only` 复现编译产物 SyntaxError，逐模块缩小到 diagnostics.js，再用单行 `/.../g` 正则字面量复现；该工具不能解析此语法。改用字符扫描替代正则后，所有实际打包脚本均通过 JerryScript 解析及此前离线检查，再次尝试安装。此项说明 Node/V8 VM 通过不足以证明 Lite 引擎可转换；已新增 `tests/jerry_parse_test.py` 为构建必要检查。

移除正则后的同版本1.1.7真机升级成功：完整文件有效性1，安装101→10→50→60→70→80→90→102，应用列表读回1.1.7。原包因失败未安装，因此重试不需要再增加版本号。成功记录 `build/install-result.json`，完整过程 `.local/logs/gt4airpointer-install-1.1.7-fixed.log`。诊断接收器已启动为 dry-run，电脑 `build/device-validation.json` 的 mouseEnabled=false；等待用户在手表重新打开应用点击 Connect 后，检查是否收到完整 watchlog 快照。

## 1.1.7 真机诊断日志已通过 BLE 回传

2026-11-14 12:03:02（北京时间）电脑收到完整10/10段，经结构校验重组并写入 `build/watch-diagnostics.ndjson`。这是实际手表应用记录的原生 API 回调，不是模拟样本；手机只做内存解析/转发，没有保存本次脚本、日志或工具。手机接收器统计11个匹配探测（1次正常探测+10段日志），ACK写出11、写出失败0。完整快照到达证明自定义诊断通道本次实测可用，不能把它等同于正常 sendMsg 输入数据通道已修复。

| 真实表端事件 | Connect后相对时间 | 回调参数 |
| --- | ---: | --- |
| setPackageName.complete | 112ms | 0个 |
| setFingerprint.complete | 114ms | 0个 |
| 再次 setPackageName.complete | 234ms | 0个 |
| subscribeMsg.success | 243ms | isRegister=true |
| detect.call → detect.success | 250→730ms | 成功回调0个 |
| sendMsg.call | 769ms | 消息长度135 ASCII字符 |
| sendMsg.fail | 3784ms | **0个，确实没有原始错误码或错误文本** |

发送调用到失败间隔3015ms。原生回调已在官方SDK重映射206之前记录，因此此前“可能SDK丢弃了更具体错误参数”的猜测在这次样本中被排除：原生fail就是零实参。135字符也低于约1KB消息预算，本次不能归因于JSON过长。初始化配置回调和接收注册成功、正常探测成功均已有表端证据，不应再把本次故障解释成未走过这些步骤。

尚未确定：3015ms是否对应固件内部某个具体超时、发送前的内部派发/手机能力限制、或其他原生实现问题。该时间特征不能单独证明根因；接收器也只证明没有解析出的0x34/01 kind=2帧，尚不能排除其他命令或链路控制报文。`receivedFrames=0`、`mouseEnabled=false`，正常指针通道及鼠标动作仍未通过。下一步应增加只含SID/CID/帧标志/长度的有界链路观测或取得原生实现证据，不反复更换路由/指纹并声称已定位。

离线复查官方SDK：W401+分支确实使用 `deviceId:'remote'`，当前调用与其一致；JS wrapper没有3秒定时器、重试或额外能力握手。公开FeatureAbility源码只按deviceId是否为空选择远端，但不能证明私有W402实现相同。未找到可公开核验的原生W402实现或3秒常量，因此不把缺少握手、特定参数或某个超时当成已确定根因。事实提取见 `build/watch-diagnostics-analysis.json`。

日志取得后已停止relay及dry-run鼠标子进程，关闭手机Frida server和TrollVNCControl、本地27043 SSH转发。复查手机Frida/debugserver/LLDB/iphone-stream/trollvnc匹配0，本机27043监听0；原有SSH服务保留。未向手机写入本次文件或日志。收尾结果 `build/diagnostics-cleanup-result.json`。
