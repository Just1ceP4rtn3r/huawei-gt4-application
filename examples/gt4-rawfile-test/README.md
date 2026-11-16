# GT4 文件读写测试 1.6.38

HUAWEI WATCH GT 4 原生 Lite Wearable 示例，源码来自 `app/GT4AirPointerRawfileTest` 的1.6.38版本。打开入口页后，向自身应用的 `internal://app/rawfile/lib/audio_decode_m55.bin` 写入256字节 `00 01 … FE FF`，再用 `readArrayBuffer` 逐字节比较。只有一致时显示 **Target verified**。

**运行会覆盖目标文件开头的256字节。** 这是任意二进制测试数据，不是有效音频解码模块。`writeArrayBuffer` 不保证截断原文件；本次实测覆盖后总长度仍为1180字节，尾部保留。不要将测试指向需要保留内容的文件。

## 真机记录与边界

2026-11-17，1.6.38 安装返回102且版本读回一致。BLE依次收到目标文件查询、`writeBinary OK` 和 `EXACT 256 BINARY BYTES VERIFIED`；随后再次查询总长度1180字节并重新校验前256字节成功。

- 此前 `internal://app/a.bin` 的100 KiB（102400字节）分块写入、长度检查及完整回读已通过；对应实现保留在 `common/rawfile-test.js`，不是本版默认入口。
- 普通两级目录 `probe/sub/a.bin`、同目录 `rawfile/lib/a.bin` 均写入成功，不能认为接口不支持多层目录。
- 旧27字节marker曾可读、不能修改并返回301；重启后用户报告文本校验成功，后来二进制测试获得BLE证据。实际文件状态后来已变为1180字节，**未证明单独重启就是根因或修复方法**。
- 固件将多个底层失败映射成301；其文案不能唯一证明路径不存在。写接口不自动创建父目录。
- 安装包不包含 `resources/rawfile`；这是运行时文件API测试。首次使用时若父目录不存在，需通过BLE测试计划依次mkdir，或在源码中添加相同准备步骤。
- `Target test complete` 只表示计划执行结束，只有 `Target verified` 表示精确比较成功。

## 构建

先按仓库根README准备本工作区SDK、Node和Frida依赖。构建不连接手机或手表：

```bash
bash examples/gt4-rawfile-test/scripts/build.sh --unsigned
bash examples/gt4-rawfile-test/scripts/build.sh --signed
```

签名材料仅从 `.local/signing/` 读取，不随示例发布。产物位于本示例 `build/`，被Git忽略。

## 安装与接收日志

需要已有配对的 CrescentRelay 与匹配的 Frida 环境；不是普通iPhone通用安装流程。包名仍为 `com.example.gt4counter`，会升级同包名应用；安装前选择高于设备现有版本的版本号，并将日志接收器的版本过滤一同更新。

```bash
bash examples/gt4-rawfile-test/scripts/install.sh --upgrade-from 1.6.37
source scripts/env.sh
/usr/bin/python3 -u examples/gt4-rawfile-test/scripts/receive-file-logs.py --seconds 180
```

退出并重新打开手表应用。接收器通过现有内存适配器获取BLE报告，不向手机写入文件、不启用鼠标输出。结果逐项轮流发送，每条低于960字符上限；必须等待所需页面收齐。结束会释放传输占用并detach。

可用 `--plan <本地JSON路径>` 下发后续步骤。例如先创建父目录再执行二进制测试：

```json
[["mkdir","internal://app/rawfile",false],["mkdir","internal://app/rawfile/lib",true],["writeBinary","internal://app/rawfile/lib/audio_decode_m55.bin"],["readBinary","internal://app/rawfile/lib/audio_decode_m55.bin"]]
```

命令只接受应用内部路径。`file.move` 在该固件中实际执行复制后删除，不可作为目录rename使用。构建同时生成 `phone-bootstrap.js`；如需恢复已有手机连接，可显式运行仓库 `scripts/prepare-iphone.py`。

## 源码与检查

- `watch/.../common/rawfile-target-test.js`：当前二进制目标测试与远程步骤执行器。
- `watch/.../pages/index/index.js`：入口和逐项BLE回传。
- `scripts/receive-file-logs.py`：接收、分片重组和可选远程计划。
- `SOURCE-SNAPSHOT.json`：源码哈希及实测边界。
- `tests/rawfile-target.test.mjs`：正常写读、损坏/短读、写入失败、超时与路径边界的离线测试；不等价于真机验证。

继承的控制/网络页面及relay支持代码来自AirPointer；当前发布不新增其功能验收。网络探测默认地址已换成文档保留地址，需要使用时自行配置。

依赖来源及许可见 [docs/SOURCES.md](docs/SOURCES.md)，项目沿用仓库AGPL-3.0许可。不发布设备身份、签名材料、会话凭证、原始日志或固件。
