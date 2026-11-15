# Mac 直连 GT4：当前方案与实测

已验证的1.5.3源码已发布到[Wi-Fi AirPointer示例](../examples/gt4-airpointer-wifi/)。新用户请使用该目录README中的配置与运行命令；本页若引用`app/GT4AirPointer/`，指原始开发和验收工作区。

记录日期：2026-11-15。表端 AirPointer 1.5.3，手机弦月 1.2.29。完整测试步骤和验收边界见 [端到端测试流程](GT4-E2E-TESTING.md)。

## 当前结论

Mac 已直接持有到手表热点网关 2000/2001 的两个 TCP 套接字，完成当前配对会话的 AES-GCM 加解密、P2P 路由与协议 ACK、应用握手、真实传感器帧接收和本机鼠标输出。一次真机测试接收并转交 **1,400 个 real-sensor 帧，pointerDropped=0**，桌面回执包含非零位移，用户确认鼠标移动。

随后 Mac 回到日常 Wi-Fi，会话进入恢复并出现 hello 超时。因此这是一次真实端到端成功，**长时间稳定性尚未通过**。报告最终 phase=error 与先前有效帧和用户确认同时保留，不能截取其中一个状态代替完整结果。

手机负责通过既有 BLE 配对会话开热点和每 20 秒续期。当前 Mac 仍须通过 USB/Frida 首次取得当前会话密钥，适配器随后卸载并 detach；业务帧通过 Mac TCP，不经手机转发。此方案尚未实现无 USB 或与手机零额外交流。

另一次手机持有 TCP 的隔离测试接收了 1,680 个真实传感器帧，并取得 pause 应用 ACK。该路径另外发送一个明确标为 synthetic-watch-test 的表端合成帧，使 Mac 光标实际右移 4 像素。后者只验证表端到桌面的输出链路，不能称腕动测试或 Mac 直连结果。

## 数据路径与启动顺序

```text
手机既有 BLE 会话 → 手表热点开启/续期
手机当前会话密钥 → USB/Frida → Mac 内存 → detach
手表真实传感器 → 手表应用 → Wi-Fi TCP 2000/2001 → Mac → 桌面鼠标事件
```

启动必须按 `hello/status → calibrate → 轮询 Ready → arm 应用 ACK → pointer 应用 ACK` 执行。旧的 pointer 后 arm 顺序曾导致 arm 超时；不能用传输写入成功替代应用 ACK。默认预览模式不 arm、不输出真实鼠标事件。

Mac 普通停止已改为 pause，保留表端应用，避免 exit 后无法可靠冷启动。停止不应由 Mac 发送热点关闭或续期指令；热点生命周期由手机管理。退出 ACK 也不能单独证明表端进程已经退出。

## 本地入口和限制

以下入口属于本工作区忽略的开发版本，**不包含在 GitHub 的 1.2.6 示例快照中**。克隆公开仓库不能直接复现这些命令；手机私有工程、当前配对会话及对应适配器也不是通用安装器。

```bash
bash app/GT4AirPointer/scripts/test-mac.sh           # 预览
bash app/GT4AirPointer/scripts/test-mac.sh --enable  # 明确启用桌面输入
bash app/GT4AirPointer/scripts/manage.sh status
```

当前脚本等待人工加入手表热点，不支持旧的 --auto-wifi。需要先在新版手机应用开启热点并保持前台，打开表端应用，再运行测试。脚本等待 en0 的 DHCP 地址及到热点网关的明确路由，最长 120 秒；连接 Wi-Fi 图标出现不等于 TCP 可用。当前入口含本机设备适配配置，迁移环境需在本地核对配置，不能照抄设备身份。

本地观测位于 app/GT4AirPointer/build/managed/ 的 state.json、events.ndjson、wire-stats.json、manager.log。旧字段 phoneAcks 在 Mac 直连时表示 Mac 收到的协议 ACK，不表示经手机转发。配对密钥和热点密码不得进入参数、日志或提交。

## 证据索引

以下文件仅存在原工作区，原始内容不提交：

- artifacts/xianyue-1.2.27-test/mac-direct-success.json：Mac 直连 1,400 帧、用户确认及后续恢复失败。目录版本名是历史命名，不代表本次手机版本。
- 同目录 isolation-final-state.json：手机 TCP 隔离测试的真实帧计数及暂停状态。
- 同目录 cursor-isolation-paused.json：明确合成来源、前后光标坐标与 4 像素位移。

Wi-Fi 寿命与前台要求见 [持续性经验](WIFI-PERSISTENCE-EXPERIENCE.md)。
