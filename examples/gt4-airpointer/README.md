# GT4 AirPointer 1.2.6：BLE → iPhone → Mac 鼠标

本目录保存已进行真机验证的 **1.2.6 BLE 转发版本**。后续网络模块探测在本地 `app/GT4AirPointer/` 开发，不属于此快照。

已验证：安装返回 102 并读回版本、真实加速度/陀螺仪与校准、手表发出的合成位移让 Mac 光标移动、左/右键事件、拖拽保持和释放。静止时真实传感器流约 7–8 帧/秒；**没有把合成位移称为真实转腕验收，滚动及实际手腕跟随体验尚未完成验收。** 详见 [1.2.6 实测记录](docs/MOUSE_ACCEPTANCE_1_2_6.md)。

此实现依赖已越狱测试 iPhone 上原有的 **CrescentRelay、Frida server、root SSH 和手表配对会话**，不是任意 iPhone 都能直接安装的通用客户端。手机工程不包含在本仓库，适配器与该应用的字段布局绑定。Mac 需为编译后的接收器授权辅助功能/事件投递权限。

## 通信路径

```text
GT4 传感器 → 校准/滤波 → 紧凑探测消息 → BLE → iPhone 现有配对会话
                                                   ↓ 内存适配器
Mac CoreGraphics ← 鼠标接收器 ← 本机管理器 ← Frida/SSH 转发
```

原生 Wear Engine `sendMsg` 仍返回失败。当前可用路径是将小型指针帧编码到探测消息中，由手机适配器解码；它是实验性协议适配，不是已修好的原生发送、TCP、Wi-Fi 或标准蓝牙 HID。下行控制使用已验证的 P2P 数据消息，上行状态和应用日志使用分段探测消息。

## 环境与目录

所有命令从仓库根目录执行。需要 macOS ARM64、Xcode 命令行工具中的 Swift、Java 17、Python、OpenSSL。根脚本将 SDK、Node、Frida 和 JS 依赖放在工作区，不全局安装。

请将仓库克隆到较短路径：管理器使用 `examples/gt4-airpointer/build/manager.sock`，其完整绝对路径需小于 macOS 的 Unix socket 路径长度限制（104 字节）。

```text
watch/       Lite JS/HML/CSS、传感器和指针协议
relay/       iPhone 内存适配器、Mac 会话管理与协议解析
desktop/     CoreGraphics 接收器及鼠标验收窗口
scripts/     构建、签名校验、安装、管理器入口
tests/       动作算法、分片、生命周期、Lite 引擎和鼠标接收测试
docs/        设计、历史故障、来源与真机验收
build/       生成文件和运行状态，Git 忽略
```

## 1. 准备环境并验证源码

```bash
bash scripts/setup.sh
bash examples/gt4-airpointer/scripts/build.sh --unsigned
```

构建包括 Lite 编译、私有 webpack 模块名压缩、SDK Jerry 解析与模拟原生 API 的运行测试、Swift 接收器、手机适配器打包，以及协议/管理器测试。离线测试不会操作手机或注入鼠标事件，也不能代替真机验收。

## 2. 从华为网页获取签名材料

完整网页操作、CSR 命令和本项目安装经验见根 [README](../../README.md) 与 [安装记录](../../docs/INSTALLATION.md)。顺序为：

1. 登录完成实名认证的华为开发者账号，在 AppGallery Connect 创建应用。
2. 在工作区生成私钥和 CSR；在开发者网页新增 Debug 证书并上传 CSR，下载证书。
3. 注册这块手表的真实调试 UDID。蓝牙身份和认证会话里的标识不能代替调试 UDID。
4. 申请绑定应用、证书及该调试设备的 Debug Profile，下载到本地。
5. 本次按用户要求复用了计数器的 `com.example.gt4counter` 和签名材料，故不能与计数器同包名共存。改包名需同时调整表端配置、协议常量和签名/安装校验脚本。

现有脚本使用 `.local/signing/` 下的 `gt4counter.csr`、`gt4counter-debug.cer`、密钥容器及 `profiles/com.example.gt4counter.p7b`。实际材料由用户自己申请，仓库不包含私钥、密码、证书、Profile 或设备 UDID。

```bash
bash examples/gt4-airpointer/scripts/build.sh --signed
```

输出为 `examples/gt4-airpointer/build/GT4 AirPointer.bin`。由 legacy Lite 工具转换、签名并验证，不能将 HAP/ZIP 简单改名替代。

## 3. 安装到手表

在 `.local/iphone.env` 设置 `GT4_IPHONE_HOST`，为已确认的手机配置工作区 `.local/ssh/known_hosts` 与现有 SSH 认证。手机应已有匹配的 Frida 服务端；本流程不向手机上传工具、脚本、包文件或日志。

```bash
# 两个终端中分别运行，服务只监听手机回环地址。
bash scripts/connect-iphone.sh server
bash scripts/connect-iphone.sh tunnel

# 另一个终端：确认当前已装版本后执行升级。
bash examples/gt4-airpointer/scripts/install.sh --upgrade-from <实际已装版本>
```

安装器使用手机进程内存中的现有配对会话，经 BLE 传输到手表；成功要求状态 102 和应用列表版本读回均匹配。不会用卸载、解除配对或跳过签名校验处理失败。

## 4. 运行鼠标转发

先运行不注入输入的模式，检查页面与会话：

```bash
bash examples/gt4-airpointer/scripts/manage.sh start
bash examples/gt4-airpointer/scripts/manage.sh status
```

自动 ping 唤起在部分场景失败，返回 201 时需打开手表应用；不能承诺通用冷启动。应用打开后会自动进入控制页并注册消息接收器。

实际鼠标测试前停止 dry-run，再显式启用：

```bash
bash examples/gt4-airpointer/scripts/manage.sh stop
bash examples/gt4-airpointer/scripts/manage.sh start --enable
bash examples/gt4-airpointer/scripts/manage.sh command calibrate
bash examples/gt4-airpointer/scripts/manage.sh command status
# 必须看到表端 ready=true / calibration=Ready 后继续：
bash examples/gt4-airpointer/scripts/manage.sh command pointer --args '{"enabled":true,"backend":"experimental-ping"}'
bash examples/gt4-airpointer/scripts/manage.sh command arm
```

表端可以 Pause/Resume、Left、Right、Drag，切换 Pointer/Scroll 和速度。切换模式会先暂停。退出页面时退订传感器、释放保亮并停止输出。

```bash
bash examples/gt4-airpointer/scripts/manage.sh command pause
bash examples/gt4-airpointer/scripts/manage.sh stop
```

管理器只清理自己创建的进程。若手动启动了上面的 server/tunnel，也应分别结束对应终端进程；保留手机原有 SSH 服务。

## 5. 观测与验收

`build/managed/state.json` 提供阶段、真实采样状态、帧数、来源和最新桌面回执；`events.ndjson` 记录控制指令、传输 ACK 和应用 ACK。传输 207 不能替代应用成功，应用 ACK 也不能替代真实鼠标事件。

可在指针持续输出前执行受控的 4 像素位移测试：

```bash
bash examples/gt4-airpointer/scripts/manage.sh command test --args '{"scenario":"cursor","dx":4,"dy":0}'
```

该测试明确标为 `synthetic-watch-test`；真实采样帧标为 `real-sensor`。完整手腕体验应另行确认移动方向、抖动、延迟、点击、滚动和失联释放。

修复记录包括：加速度单位 g、Lite 堆内存限制、整条 BLE 消息串行以防分片互插、相对时钟活跃判断、心跳与旧超时冲突，以及探测通道的 1.5 秒拖拽失联释放。手机内存适配器和接收器必须保持运行，关闭它们会停止控制。

本目录源码遵循根许可证；参考与来源见 [SOURCES](docs/SOURCES.md)。
