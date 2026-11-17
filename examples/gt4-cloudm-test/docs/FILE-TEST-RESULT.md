# 文件写入与 BLE 自动验收

## 已完成

- 版本 1.6.29 已收到安装状态102，并从手表应用列表读回。
- 已通过 BLE 接收到真实应用报告：`phase=verified`、`uri=internal://app/a.bin`、`bytes=33`、`method=text`。
- 应用只有在 writeText 成功、readText 返回内容与预期完整相等时才报告 verified。真实事件包含 `text write OK` 和 `text read OK`。
- 内容为 `GT4 FILE TEST DEMO-03\n0123456789\n`。原始文件为 `test-data/rawfile-demo-03.bin`，不是原生可执行模块。
- 证据：工作区 `artifacts/rawfile-install-diagnosis/ble-file-success.json`；完整应用日志在 `build/file-ble-results.jsonl`。

## 自动日志与重试

Mac 接收器 `scripts/receive-file-logs.py` 复用已配对 iPhone 的内存 BLE 适配器，只接收当前应用的 DEMO-02 诊断信封（历史信封名；当前默认内容是 DEMO-03），按片段重组 JSON，保存本地日志。应用每两秒报告状态，文件操作由单个轮询状态机串行推进，避免在原生回调中立即嵌套发起下一次文件操作。每一步有五秒截止时间。

默认首次打开应用在根目录 a.bin 写入并回读33字节文本。`--case 3 --method binary` 可通过 BLE 请求根目录320字节二进制测试；不能把请求发出或旧文本成功报告当作二进制测试成功。当前这项额外测试遇到配对会话变化，没有取得成功证据。

应用测试页保持屏幕常亮，离开测试页会释放该设置并停止日志通道。接收器结束时释放借用的手机通道并 detach，不在手机创建工具或日志文件。

## 尚未解决的边界

- 原路径 `internal://app/rawfile/lib/audio_decode_m55.bin` 的 write 301 尚未证明根因或修复。成功结果仅适用于上述根目录短文件路径。
- 原生 `resources/rawfile` 包安装70%后103是另一个安装阶段问题；现阶段继续绕开该路径。
- 不将旧版被遮挡的界面、离线模拟或没有回读的写入称为真机成功。

## 开源参考

[Explore-In-HMOS/sportwatch-how-to-do-file-operations](https://github.com/Explore-In-HMOS/sportwatch-how-to-do-file-operations) 的 README 声明支持 GT4，源码使用 @system.file 在应用根目录直接 writeText，并提供 Uint8Array 写入示例。没有找到其明确的固件版本和真机回读记录。它的初始化完成计数同时在成功和失败时增加，因此其成功提示不能直接用作验收逻辑。本项目使用实际回读相等和 BLE 结果进行验收。
