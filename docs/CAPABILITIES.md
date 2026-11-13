# GT4 第三方表端应用能力清单

核对日期：2026-11-13。适用对象为本项目中的 HUAWEI WATCH GT 4，设备安装服务实测报告 API 12、466×466，采用 Lite Wearable / FA / JS＋HML＋CSS。手机为 iPhone。

本清单描述第三方安装的表端应用能够使用的接口。手机伴侣通过蓝牙管理手表的能力、手表系统自带功能，以及第三方表端应用的权限并不等价。

## 阅读口径

- **真机通过**：本次项目已在这块 GT4 上完成验证。
- **官方接口，待实测**：官方列为 Lite Wearable 能力，但本项目尚未逐项调用验证。需进一步核对接口起始版本、硬件、权限和返回结果。
- **条件能力**：还依赖配套手机应用、服务申请、名单、专用权限或新版本。
- **当前不能依赖**：已知限制，或没有足够证据将其列为当前 API 12 的普通应用能力。

设备报告 API 12 不表示全部 HarmonyOS API 12 接口均可用；还必须匹配 Lite Wearable 的系统能力和 FA 模型。本项目当前构建环境是保留 legacy lite 编译器的 API 9 SDK，新增 API 10/12 能力时还需检查对应 SDK 或厂商扩展能否编译。

## 1. 界面、交互和本地逻辑

| 能力 | 可实现的功能 | 当前判断与边界 |
|---|---|---|
| 文本、布局、点击、数据绑定 | 计数器、计分板、状态面板、详情页 | **真机通过**：本次计数、归零和界面更新已验证 |
| 图片与轻量组件 | 图标、列表、分页、滑块等 | 官方支持 Lite 组件；具体组件与属性按 Lite 文档选择，不能套用完整网页或 ArkUI 组件集 |
| 页面跳转与生命周期 | 多页工具、列表到详情、页面初始化与清理 | 官方接口，待实测；页面切换可能销毁旧页面，不能依赖完整网页式返回栈 |
| 定时与时间计算 | 前台秒表、倒计时、刷新时钟 | 可作为前台 JS 逻辑实现；退出或被销毁后，不能依赖计时器继续执行。恢复时应通过时间戳重新计算 |
| 多语言 | 中英文界面、资源切换 | 官方支持 i18n 资源；注意中文长度、圆屏边缘和字体适配 |
| 表冠交互 | 列表滚动、滑块调整、分页选择 | 官方指南列出 list、slider、swiper 的获焦交互；需按组件管理焦点，尚未在本机测试 |
| 绘图和动画 | 简单图形、趋势图、小型游戏 | 只按 Lite 图形接口子集设计。公开 Lite 游戏项目有实现，不能假定完整 HTML Canvas、WebGL 或浏览器 DOM 可用；本机未测 |

界面、页面和表冠依据：[官方 Lite 开发指南](https://developer.huawei.com/consumer/cn/doc/lite-wearable-guides/lite-wearable-bpta-guide/)。绘图实践参考：[HuaSideload 的 Lite 游戏源码](https://github.com/burak4arslan/huawei-watch-sideload-ios/tree/main/watch-apps)，其作者实测设备为 GT3 SE，不能替代本机验收。

## 2. 存储与设备基础能力

| 能力 | 接口入口 | 使用边界 |
|---|---|---|
| 键值持久化 | `@system.storage` | 设置、分数、少量状态；适合小值，不应当作大型数据库。本次计数器还未接入持久化 |
| 应用私有文件 | `@system.file` | 文本、二进制、小型离线数据和文件目录操作；使用应用沙箱 URI，不能任意访问系统或其他应用文件 |
| 型号、语言、屏幕等设备信息 | `@system.device` | 用于布局和能力适配；设备信息接口不是获取调试 UDID 的通用替代品 |
| 电量与充电状态 | `@system.battery` | 查询本机电量、充电状态；本项目未从表端调用测试 |
| 亮度、亮度模式、保持亮屏 | `@system.brightness` | 常亮可阻止无操作超时灭屏，不能阻止用户盖屏等主动灭屏，也不等于后台保活 |
| 触觉反馈 | `@system.vibrator` | 长／短振动，需要 `ohos.permission.VIBRATE`；不把高级自定义振动效果默认列为可用 |
| 加密、摘要、随机数及密钥保护 | 对应 Lite SysCap 下的密码学接口 | 只使用目标版本明确支持的子集；HUKS、算法、密钥用途和接入条件分别核对。本项目尚未验证表端密码学调用 |

以上普通接口均为“官方接口，待实测”。官方文档明确部分 `@system.*` 模块对 Lite Wearable 持续维护；文档中针对其他设备的废弃提示不等于 Lite 也不可用。

依据：[键值存储](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-system-storage/)、[文件存储](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-system-file/)、[设备信息](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-system-device/)、[电量](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-system-battery/)、[亮度](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-system-brightness/)、[振动](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-system-vibrate/)、[Lite 系统能力列表](https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V5/syscap-list-litewearable-V5)。

## 3. 传感器与定位

官方 `@system.sensor` 提供下列订阅接口。这里列的是接口范围，**不代表这块 GT4 的每个传感器都已验证**。需要硬件支持，并处理无权限、无数据和不支持等结果。

| 数据 | 典型入口 | 可以实现的功能／注意事项 |
|---|---|---|
| 三轴加速度 | `subscribeAccelerometer` | 动作与晃动检测；需相应权限，采样频率影响功耗 |
| 陀螺仪 | `subscribeGyroscope` | 旋转、运动姿态输入；需相应权限 |
| 罗盘方向 | `subscribeCompass` | 方位指示；不等于任意读取原始磁力计数据 |
| 设备方向 | `subscribeDeviceOrientation` | 姿态交互；以实际返回字段和方向约定为准 |
| 心率 | `subscribeHeartRate` | 当前心率展示与前台反馈；不等于读取全天心率历史、ECG 或原始 PPG |
| 步数 | `subscribeStepCounter` | 计步展示；官方定义为传感器重启后的累计计数，不可直接当成当天三环步数 |
| 气压 | `subscribeBarometer` | 气压趋势；通过气压推算海拔还需要校准和算法 |
| 佩戴状态 | `getOnBodyState`、`subscribeOnBodyState` | 判断是否佩戴，按状态调整采样 |
| 环境光、接近状态 | `subscribeLight`、`subscribeProximity` | 存在官方接口，但须确认具体型号的硬件和行为，不列为 GT4 已确认能力 |
| 经纬度、海拔 | `@system.geolocation` | 获取或订阅位置，需要位置权限及可用定位条件；Lite 返回的 `accuracy` 字段可能无效，不能据此承诺定位精度 |

传感器应成对订阅与退订，在页面销毁时清理。权限按具体接口和所用 SDK 声明；本地 SDK 示例包括 `ACCELEROMETER`、`GYROSCOPE`、`ACTIVITY_MOTION`、`READ_HEALTH_DATA`，不能将一个健康权限当作所有健康数据的授权。

依据：[官方传感器接口](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-system-sensor/)、[官方地理位置接口](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-system-location/)。

## 4. 手机通信、网络及专项服务

| 能力 | 当前 GT4＋iPhone 的判断 |
|---|---|
| 与配套手机应用收发消息／文件 | **条件能力**：Wear Engine 有手机与穿戴协同方案，支持 Android、iOS。需匹配旧 Lite SDK、手机端接入、包名／指纹及授权；本次计数器尚未验证应用间 P2P 收发 |
| 手机联网后把数据同步到表端页面 | 可采用手机取数据、通过配套通道下发、表端缓存和展示的架构；这是可实施的设计推论，需要单独验证链路 |
| 表端 `fetch` 请求网络 | **当前组合不能依赖**：官方明确 GT5 及更早型号与 iOS 配对时无法发起 fetch。更换为 Android 也仍受地区及请求大小限制 |
| 音频播放 | **名单控制**：`@system.audio` 要求包名纳入音乐服务名单，不是普通调试应用直接获得的能力。官方 Lite 音乐方案为本地 MP3 播放，不支持按完整流媒体播放器设计 |
| 控制手机音乐、显示导航等 | 依赖手机伴侣和授权协议；手机侧的系统媒体控制权限也要单独处理 |
| NFC / HCE / 支付 | **专项集成**：官方有分布式 HCE 支付方案，涉及权限、支持机型、手机 SDK、服务商及业务接入。不能由“手表有 NFC”推出普通应用可读任意卡、复制门禁卡或直接开发银行卡支付 |
| 运动联动、系统锻炼记录读写 | 新版 `@hms.health.service`、`@hms.health.store` Lite 接口起始为 **API 24**，还需相应服务和用户授权。当前报告 API 12 的这块 GT4 不列入默认可用清单 |

依据：[Wear Engine 产品能力](https://developer.huawei.com/consumer/cn/hms/huawei-wearengine)、[接入流程](https://developer.huawei.com/consumer/cn/doc/connectivity-guides/dev-process-0000001051058039/)、[iOS 用户授权](https://developer.huawei.com/consumer/cn/doc/connectivity-Guides/request-user-authorization-ios-0000001920933293/)、[官方 fetch 限制](https://developer.huawei.com/consumer/cn/doc/lite-wearable-guides/lite-wearable-bpta-guide/)、[音频名单限制](https://developer.huawei.com/consumer/cn/doc/lite-wearable-references/litewearable-audio-js)、[音频方案](https://developer.huawei.com/consumer/cn/doc/lite-wearable-guides/lite-wearable-entertainment-solution/)、[HCE 方案](https://developer.huawei.com/consumer/cn/doc/lite-wearable-guides/lite-wearable-pay-solution/)、[HealthStore Lite](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/health-api-healthstore-lite/)、[HealthService Lite](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/health-api-healthservice-lite/)。

## 5. 当前不能直接作为产品承诺的能力

| 需求 | 判断 |
|---|---|
| 全天后台轮询、退出后定时提醒 | 普通 Lite 应用不具备通用后台常驻能力。前台倒计时不能替代系统闹钟；专项音乐／运动服务有独立规则 |
| 熄屏后继续运行并随时自动弹出 | 不能通过保持亮屏接口推导出这项能力；官方基础指南也不提供通用熄屏动作监听 |
| 任意读取系统通知、短信、通讯录、日历 | 本次未找到适用于当前普通 Lite 表端应用的通用公开路径，不能把手机侧管理协议当成表端权限 |
| 全天健康历史、睡眠、血氧、ECG、原始 PPG | 不能从 `@system.sensor` 的心率／计步接口推导。需另行核对特定服务、版本、资质与授权 |
| 录音、语音助手、相机 | 不因设备存在麦克风或系统语音功能就默认向第三方应用开放；本次未验证当前版本的公开接入路径 |
| 任意扫描连接 BLE 外设、直接 Wi-Fi、Socket | 不因手表系统能用蓝牙就认定普通表端应用可用。当前项目应先使用已核实的手机协同接口，其他直连需求单独做 API 与 SysCap 评估 |
| 完整 ArkTS Stage / ArkUI / WebView / Node.js / 任意原生库 | 不属于当前已打通的 JS FA Lite 开发路线，不能套用普通 WATCH 或手机工程能力 |
| API 24 的设置、运动健康等新模块 | 版本不匹配；不以最新 Lite 文档首页出现接口作为 API 12 已支持的证据 |

生命周期边界见[官方 Lite 指南](https://developer.huawei.com/consumer/cn/doc/lite-wearable-guides/lite-wearable-bpta-guide/)，新设置接口的起始版本见[settingsLite](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-settings-lite)。

## 6. 本项目下一步的能力验证顺序

1. 本地保存计数和设置：先做 `storage`；较大的结构化内容再做私有文件读写。
2. 按键短振动、亮度、电量：以独立按钮逐项验证，记录权限和错误码。
3. 前台倒计时：验证重新打开后用时间戳恢复，不承诺退出后提醒。
4. 心率、佩戴状态、加速度和定位：各自加入最小权限，分别记录支持情况与实际回调。
5. 手机到表端的数据页：先完成配套 iOS 应用到表端自定义应用的一条消息回路，再做列表、详情和离线缓存。

这是验证顺序建议，本次没有为整理能力列表重新启动手机 Frida、远控或安装新测试应用。此前安装成功证明的是构建、签名、安装和基础交互流程，不能替代其他系统 API 的真机验收。
