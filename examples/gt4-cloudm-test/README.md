# GT4 Cloudm 音频测试

成功记录、有效配置、排障经验、构建安装与 BLE/系统日志流程已完整整理到 [readme](readme)。

当前版本 1.0.20，包名 com.netease.cloudm。2026-11-17 已真机安装（102、读回 1.0.20），用户确认“听到声音了”；BLE 同轮确认文件精确回读、onplay、进度 1→3→5 秒、onended、errors=0。

入口保留原 AirPointer 1.2.6 的启动页，再路由到 pages/audio/audio。音频页按顺序创建目录、分块写入与回读原始 1144 字节模块及 120352 字节 MP3、写入两个播放列表文件，随后调用 system.audio。每次启动会重写、核验文件，准备约一分钟后自动播放，具体以 BLE 日志为准。

有效列表为 `10020.tmp,1,0,8,DiagnosticTone,Local;`，保存在 internal://app/diag_playlist_120；internal://app/cur_playlist 内容为 `diag_playlist_120`。普通 MP3 关闭外部 XOR 变换（第三字段为 0）。音频为 880Hz、44.1kHz/128kbps/mono MP3，离线时长 7.522 秒，应用请求 volume=0.5。文件准备后等待 2.5 秒显式 play 一次；立即查询状态可能仍为 stop，后续异步采样可见实际进度。

构建：`bash app/GT4CloudmTest/scripts/build.sh`。使用新 Cloudm Profile，执行真实编译脚本的 SDK 离线测试；离线测试不代替真机结果。签名产物为 build/GT4 Cloudm.bin。

BLE 收日志：先 source scripts/env.sh，再执行 `/usr/bin/python3 -u app/GT4CloudmTest/scripts/receive-audio-logs.py --duration 600`。build/audio-ble-results.jsonl 保存原始报告，build/audio-latest-summary.json 保存当前摘要。与安装器、manager、DFX 日志下载器顺序使用，避免争用连接。

原 AirPointer manager 代码仍保留，默认 dry-run。原包名 1.2.6 已验证自主退出和重新打开；Cloudm 包普通 JS 业务下行仍有 206，不能将 ping 202 等同于本版本页面已加载。此次 1.0.20 由用户打开，不能记录为自主打开成功。

完整结论与证据位于 artifacts/cloudm-audio-analysis/AUDIO-CURRENT-JUDGMENT.md、verified-result-1.0.20.json。已保存本轮源码快照 source-1.0.20-audible-confirmed/ 和源码、签名构建的哈希。系统日志下载后的解析位于 dfx/after-audible-1.0.20-analysis.json。
