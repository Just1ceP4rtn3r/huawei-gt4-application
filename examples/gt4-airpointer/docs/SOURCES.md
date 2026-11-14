# 来源、实现范围与许可

## 参考资料

- [musubipapi/airpointer](https://github.com/musubipapi/airpointer)：参考动作指向、校准、敲击和失联停止的交互思路。本项目没有复制其 AirPods 私有链路、姿态算法、素材或声音。其硬件、传感器数据和要求与 GT4 不同。
- [华为 Lite Wearable 开发指南](https://developer.huawei.com/consumer/cn/doc/lite-wearable-guides/lite-wearable-bpta-guide/)：JS/HML/CSS、生命周期、圆屏和官方安装入口。
- [华为传感器接口](https://developer.huawei.com/consumer/en/doc/harmonyos-references/js-apis-system-sensor/)：加速度、陀螺仪、订阅/退订、采样档位与权限；对应本地 SDK 的 `@system.sensor.d.ts`。新文档中其他设备的 ArkTS 写法不能直接套到 Lite JS。
- [较早 Lite 传感器兼容性文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-references-V3/lite-wearable-system-sensor-0000001222566847-V3/)：具体设备和权限有差异，实际可用性须在当前 GT4 测试。
- [Lite Wear Engine 消息示例](https://github.com/Explore-In-HMOS/sportwatch-wear-engine-lite-wearable-to-mobile)：表端和手机消息通信的参考，公开示例主要配套 Android，不能据此认为当前 iPhone 已打通。
- [HuaSideload](https://github.com/burak4arslan/huawei-watch-sideload-ios)，固定根工作区提交 `c256b8acb95d013e9491b4da05ffeed1f59aeec9`：参考 Lite runtime messaging bridge、Huawei P2P 服务格式和已有安装实现。
- [Apple CGEvent](https://developer.apple.com/documentation/coregraphics/cgevent)：鼠标、滚动事件和事件发送。
- [Apple CGRequestPostEventAccess](https://developer.apple.com/documentation/coregraphics/cgrequestposteventaccess())：事件投递权限，用户通过系统设置授权。

## 复用与许可

项目遵循根 [AGPL-3.0-or-later 说明](../../../THIRD_PARTY_NOTICES.md) 和 [许可正文](../../../LICENSE)。

- `watch/` 的页面、运动算法、限流发送器与 `desktop/MouseSink.swift` 为本次新增实现。
- `relay/iphone-agent.js` 由根 `scripts/phone-bridge.js` 改编，保留既有配对会话的加密/帧/内存适配方式，将端点范围替换为新应用限定的 P2P 接收与应答。
- `relay/protocol.js` 依据 HuaSideload/Gadgetbridge 的 P2P wire 格式；同时只读核对本机已有 CrescentRelay 的已知路由处理行为，未修改或复制其手机工程。
- 签名校验、CMS 校验和安装通道由根项目脚本按独立包名和项目输出目录改编。实际编译器与包检查工具仍调用根工作区的固定上游副本。
- 图标暂沿用原计数 demo 的本地资源。没有使用 AirPointer 的 Apple 外观模型、图片或声音。

所有资料用于设计与兼容性核对，设备支持声明不替代本项目的 [验收记录](ACCEPTANCE.md)。
