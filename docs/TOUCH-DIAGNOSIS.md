# iPhone 全局触屏失效：已确认的自动化触发路径

2026-11-15 受控测试已复现并捕获调用栈：开发机旧测试脚本直接调用 SpringBoard 系统弹窗的 `UIInterfaceActionRepresentationView.invokeInterfaceAction`，使 `default` 忽略交互计数残留。该调用位于测试脚本，不在弦月1.2.29正式IPA内。Mac鼠标链路无需这条系统弹窗自动点击路径。

## 证据与因果链

| 测试阶段 | SpringBoard默认忽略计数 | 观测 |
|---|---:|---|
| 空闲、系统设置与弦月切换对照 | 0 | 无计数残留 |
| 弦月调用系统加入API，加入弹窗正常展示完成 | 0 | UIPresentationController的begin/end配对 |
| 旧测试脚本直接invokeInterfaceAction | 增加1 | 调用栈首帧为UIKitCore的invokeInterfaceAction，其下为脚本原生调用 |
| 弹窗dismiss完成 | 1 | dismiss转场自己的begin/end配对，没有解除私有动作留下的额外计数 |
| 随后12秒及另一个系统提示转场完成 | 1 | 仍为isIgnoringInteractionEvents=true |
| 精确解除这1项，未重启 | 0 | 忽略状态恢复false |

此前用户报告的全局触屏失效现场为同一机制：default计数3、忽略状态true，HID仍收到Digitizer事件，触摸服务DeviceIsReady=true、Critical errors=0；SpringBoard主线程和事件线程在3秒106样本中正常等待事件。逐次解除3项后，未重启桌面、未退出弦月，用户立即确认触屏恢复。

受控复现确定了旧私有弹窗调用会产生相同的计数残留；此前每一次故障没有事前调用栈，不能重建历史3项分别来自哪一次操作。关闭Frida服务不会自动平衡已经留在SpringBoard里的计数，因而此前仅停服务未恢复、重启SpringBoard才能恢复，与该机制一致。

## 源码与安装包复核

手机安装的1.2.29与兼容IPA的27个__TEXT节哈希一致。源码及二进制选择子扫描未发现beginIgnoringInteractionEvents、endIgnoringInteractionEvents、setIgnoresInteractionEvents:、invokeInterfaceAction或私有后台进程断言调用。正式包未编入此前研究过的私有后台保活方案。

HotspotManagement开关与续期通过现有BLE加密FIFO提交，busy只门控弦月自身功能按钮。WatchHotspotJoiner使用系统NEHotspotConfigurationManager.apply；本次加入提示展示已观测到正常平衡。不能把测试脚本对系统弹窗的私有调用归入正式App代码。

## 修复与后续操作

- 已停用旧join-alert RPC：明确返回disabled，不再调用私有动作。开发机源文件与bundle均已更新。
- 停用后对照：join-alert 返回 joined=false、disabled=true；随后12秒每2秒观察，SpringBoard始终isIgnoringInteractionEvents=false、default计数0，未出现交互禁用调用。这只证明停用入口不再触发，新的真实HID方案尚未实现。
- 另一wifi-alert工具的私有调用已改为直接报错，避免处理“无法加入”提示时再次引入残留。
- 原始脚本与哈希仅保存在工作区私有证据目录，以便追溯；不作为可运行入口继续使用。
- 后续系统提示应使用真实触摸/HID路径或用户正常点击。新自动化方案须取得交互计数无残留的设备验证，不能仅凭“弹窗消失”称成功。
- 不在正式App加入强制清零系统交互计数的补丁；该处理只用于确认故障后的诊断恢复。

## 证据位置

私有证据在 `artifacts/touch-diagnosis/`：`trace-join.ndjson`为调用栈与计数时间线，`confirmed-trigger.json`为脱敏结论，`repro-recovery.json`为恢复读回，`xianyue-binary-audit.json`为安装包核对。`finding.json`保留最初现场，后续归因以本页和confirmed-trigger为准。所有记录在开发机，手机未创建诊断文件。
