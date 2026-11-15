# GT4 Wi-Fi AirPointer 1.5.3

已在 HUAWEI WATCH GT 4 上验证的 Wi-Fi 鼠标控制源码。表端使用 Lite Wearable JavaScript、HML、CSS；Mac 直接连接手表系统 TCP 2000/2001，解密真实传感器帧并发送 macOS 鼠标事件。

原 [BLE 转发示例](../gt4-airpointer/) 保留1.2.6版本。本目录表端源码来自已安装验证的1.5.3；`SOURCE-SNAPSHOT.json`记录源码摘要。公开整理修改了目录引用和设备配置入口，需在新设备上独立验收。

## 已验证范围

- GT4 AirPointer 1.5.3、iPhone 弦月1.2.29/build35、Mac直连双TCP：1,400个真实传感器帧接收并转交，0丢帧，非零桌面位移，用户确认鼠标移动。
- 手机TCP隔离路径：真实帧及暂停ACK通过；独立标记的表端合成测试帧使Mac光标向右移动4像素。合成帧不能代替转腕验收。
- 启动顺序为校准并等到Ready → arm应用ACK → pointer应用ACK。普通停止使用pause，不退出表端App。
- 长时间连接稳定性、手机后台续期及点击/拖拽的完整物理验收尚未通过。Mac曾切回日常Wi-Fi而中断会话。此项目不是无需条件的长期后台鼠标产品。

## 链路与依赖

```text
弦月App ── BLE开启热点、每20秒续期 ── GT4
                                         │
Mac鼠标输出 ← Mac管理器/解密 ← Wi-Fi TCP ──┘
```

目前仍需iPhone通过USB连接Mac：启动时用现有SSH/Frida服务读取当前BLE认证会话密钥，随后卸载适配器并detach；持续鼠标数据走Mac与手表的TCP。会话密钥只在内存和匿名管道中传递。未实现无USB配对，也不支持把系统TCP改成明文：真机明文请求返回100010。

手机需安装 [弦月1.2.29源码](https://github.com/Just1ceP4rtn3r/xianyue/commit/74a0329)，已与手表正常配对。当前适配器只匹配该兼容包的现有会话布局，换版本须重新核对，不是通用iOS桥接SDK。手机App需保持前台，后台约60秒失去热点的对照仍未解决。

## 目录

- `watch/`：完整Lite工程，含历史诊断页；正常入口自动进入鼠标控制页，诊断页不作为已验收传输方案。
- `relay/`：Mac原生TCP、AES-GCM、P2P封装、应用管理及手机内存适配器。
- `desktop/`：macOS鼠标输出与独立测试窗口源码。
- `scripts/`：构建、签名验证、安装和手动加入Wi-Fi后的测试入口。
- `tests/`：算法、协议、编译产物、权限门控及模拟生命周期检查。
- `build/`：自动生成且被Git忽略，不包含在源码快照中。

## 准备与构建

从仓库根目录执行。依赖原仓库的工作区工具链，先按[根README](../../README.md)准备Lite SDK、Node16构建环境、Frida17.23.2及`tools/frida-agent`依赖；Mac控制与加密测试另需现有的现代Node（建议Node22或更新）、Python3、Xcode命令行工具和iproxy。不进行全局安装。

```bash
bash examples/gt4-airpointer-wifi/scripts/build.sh --unsigned
```

构建会运行离线检查、编译MouseSink和手机适配器。离线检查中的SDK、传感器和原生接口替身不代表真机测试。

真机签名使用根仓库已有手动签名流程及`.local/signing/`，材料不随示例发布。当前工程复用`com.example.gt4counter`身份，Profile需包含实际手表调试UDID及所需权限；请确认允许升级现有同bundle应用。

```bash
bash examples/gt4-airpointer-wifi/scripts/build.sh --signed
# 仅针对已配对设备；按实际已装版本显式允许升级，禁止卸载绕过校验。
export GT4_FRIDA_DEVICE_ID=YOUR_IPHONE_USB_DEVICE_ID
bash examples/gt4-airpointer-wifi/scripts/install.sh --upgrade-from YOUR_INSTALLED_VERSION
```

安装脚本要求手机既有SSH/Frida连接准备好；仅构建不会自动安装。本机签名文件命名沿用原计数器工作区约定，自己的证书、Profile及应用身份应按根文档配置。

## 启动鼠标

1. 将`device.env.example`复制到仓库`.local/gt4-airpointer-wifi.env`，填写自己的USB设备标识和SSH可信主机别名。已有独立`.local/ssh/known_hosts`中必须有匹配项；工具不跳过主机校验，SSH须已具备非交互认证。
2. 手机弦月进入“手表功能 → 手表热点”，点击开启并保持前台。Mac在系统Wi-Fi中手动加入当前返回的热点和密码。手机无需“一键连接此Wi-Fi”。脚本不会切换Mac Wi-Fi。
3. 保持USB连接，打开手表AirPointer，在Mac运行：

```bash
# 默认仅预览
bash examples/gt4-airpointer-wifi/scripts/test-mac.sh
# 真正发送本机鼠标事件
bash examples/gt4-airpointer-wifi/scripts/test-mac.sh --enable
```

启动时保持手腕静止，直到明确Ready；出现`mac-direct-running`且`enabled:true`后再转腕。Mac需授予事件输出程序必要的辅助功能权限。日志仅存本地`build/managed/`，请勿将其提交仓库。

```bash
bash examples/gt4-airpointer-wifi/scripts/manage.sh status
```

检查`controlReady=true`、`armed=true`、`pointerReceived/Forwarded`增长、真实传感器origin与桌面回执。TCP ACK不等于手表应用ACK，也不等于实际鼠标动作。状态中的历史字段`phoneAcks`在Mac路径中记录由Mac接收的P2P协议ACK。

Ctrl-C会暂停表端输出，关闭本轮TCP和管理器，清理本次启动的Frida服务及USB转发。原来已有的服务会保留。手机App自身热点续期不由Mac脚本停止，需要结束热点时在手机显式关闭。连接丢失会停止测试，不自动重放点击。

## 已知故障与边界

- `ECONNREFUSED port=2000`：系统TCP服务不接收连接，不能用Wi-Fi地址或续期写入计数当作服务健康证据。查看手机热点实际状态，显式关闭后等待，再重新开启；过快关开曾失败。
- 校准未Ready时不得arm。已修复固定等待2秒导致的过早arm，以及先开流再arm的回执超时路径。
- 热点密码可能在配置反馈中更新，使用手机页面当前显示的配置。
- 禁止通过SpringBoard的`invokeInterfaceAction`直接处理系统弹窗；它在旧开发机测试工具中留下全局忽略交互计数，导致触屏失效。本示例没有包含那些弹窗工具，也不自动操作iPhone Wi-Fi。
- 当前仍依赖手机续期与首次会话材料获取；断连重认证后旧密钥不可硬编码复用。

[全套测试方案](../../docs/GT4-E2E-TESTING.md) · [Mac直连经验](../../docs/MAC-DIRECT-TEST.md) · [触屏故障确证](../../docs/TOUCH-DIAGNOSIS.md) · [协议来源与许可](docs/SOURCES.md)
