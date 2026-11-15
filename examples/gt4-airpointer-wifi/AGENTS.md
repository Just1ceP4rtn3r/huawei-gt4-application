# GT4 Wi-Fi AirPointer 示例

- 本目录是用户授权公开的1.5.3源码快照，原BLE示例位于相邻gt4-airpointer目录。
- 继承根工作区环境、缓存、签名和手机零额外文件约束。
- watch为Lite JS/HML/CSS；relay为Mac TCP/认证与会话控制；desktop为实际macOS鼠标输出。
- 默认dry-run，仅显式--enable才能控制鼠标；失联停用并释放拖拽。
- 禁止使用SpringBoard系统弹窗的invokeInterfaceAction私有调用；该路径已在真机复现交互计数残留。
- 不提交build、签名证书、Profile、会话密钥、设备标识、密码或私有日志。
- 不把离线模拟、合成移动帧或既有设备结果写成新用户设备已验收。当前鼠标移动已验证，点击/拖动及长稳范围见README。
