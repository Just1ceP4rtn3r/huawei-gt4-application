# 1.2.6 真机鼠标通道验收

## 已完成

用户打开 1.2.5 后，实际应用 ready、hello/status、传感器计数和校准均通过。随后更新 1.2.6，安装状态 102、应用列表版本读回成功；本次更新后的启动与握手成功，不因此推断所有冷启动场景均已解决。

1.2.6 使用 experimental-ping 紧凑指针通道。原生 sendMsg 的 206 尚未解决，不能称为原生发送成功。

- 表端合成测试帧经过真实 BLE、iPhone、Mac 接收器，实际光标横向移动 4 像素。合成帧仅验证传输与桌面输入，不作为真实手腕运动证据。
- 真实加速度/陀螺仪校准返回 Ready，真实传感器帧保持 armed=true 持续到达 Mac，观察约 7–8 帧/秒。静止时 dx/dy 为零。
- 电脑下发按钮命令，表端将按钮事件编码发送回来；本机 MouseTestTarget 窗口实际收到 leftDown/leftUp、rightDown/rightUp。
- 拖拽开始后桌面回执 dragging=true；第二次拖拽命令后 dragging=false，测试窗口收到对应左键按下/松开。
- 接收器保持 enable 模式，未在验收后退出手表或停止实际输入。用户可转腕使用，表端 Pause 可暂停。

以上不是完整的手腕操控体验验收：截至记录时手表静止，尚无非零真实手腕位移或实际滚轮事件的设备证据。不能将合成位移、远程按钮命令称为用户已测试全部手势或流畅度。

## 本轮修复

1. 手机发送队列此前逐 BLE 分片串行，但整条消息未串行。并发的多片管理 ACK 能插入命令分片，破坏重组。改为整条消息 Promise 队列；真实指令再次获得 207 与应用 ACK。并发离线测试直接执行生产 frames/writeBody，验证三片命令与两片 ACK 不互插，以及前一消息失败后下一消息继续。
2. 管理器活跃判断不再要求两端绝对时钟误差小于两秒。已握手会话中用连续递增指针建立相对时间基线，拒绝重放、退休会话和额外延迟过大的帧。新增 sent 观测字段。
3. 表端旧 Mac 回执 1.8 秒超时不再覆盖仍有效的管理心跳租约，避免指令 ACK 期间误暂停。arm 回复改为短状态，按钮指针优先发送。
4. 紧凑探测通道的桌面失联看门狗从 0.5 秒调整为 1.5 秒，其他通道仍为 0.5 秒。显式暂停仍立即释放拖拽；针对两种超时的离线断言通过。修复后实际拖拽保持与释放通过。

## 文件与证据

- `.local/logs/gt4airpointer-install-1.2.6.log`：安装及读回。
- `.local/logs/gt4airpointer-mouse-1.2.6.jsonl`、`gt4airpointer-final-mouse.jsonl`：实际合成位移、校准、启用及真实流状态。
- `.local/logs/gt4airpointer-mouse-target.jsonl`：仅本测试窗口收到的鼠标事件，不监听其他应用输入。
- `.local/logs/gt4airpointer-final-drag-hold.json`、`gt4airpointer-final-drag-end.json`：真实拖拽状态。
- `build/managed/state.json`、`events.ndjson`：当前运行状态与会话记录。

本次没有给 iPhone 写入脚本、安装包或日志；内存适配器与 SSH 转发仍是当前运行路径的必要组成部分。停止它们将停止鼠标控制。测试窗及接收器均在工作区编译、运行。
