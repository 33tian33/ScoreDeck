# ScoreDeck CS 2.14.1 验证记录

- 完整自动回归：47 项，46 通过，0 失败，1 项沿用环境跳过。命令：`node --test tests/*.cjs radarhud/tests/*.cjs`。
- 浏览器完整链路：真实 ScoreDeck / RadarHUD 服务接收模拟 GSI，中文按钮经导播代理发送到模拟 TCP 控制端。8 张地图共 36 个按钮均发送准确的预置命令，始终复用一个控制连接。
- 已验证：换图后按钮更新、旧地图请求拒绝、道具跟随计时器取消、返回原选手、未知地图和主菜单隐藏、GSI 超时及恢复、控制断线禁用。
- 界面检查：980、1366、1920 × 420 三种尺寸，无横向溢出，阿努比斯 6 个按钮中文标签完整。截图和结果在源码 `verification/camera-presets-*`。
- 发布包校验方法：ZIP CRC、逐文件 SHA-256、Windows EXE/DLL PE 完整性及官方 Electron 主程序大小、哈希、x64 架构检查。脚本：`scripts/verify-windows-package.py`。

测试环境为 Linux 浏览器与模拟 CS2 控制端；未运行真实 Windows、CS2 或 GOTV。命令发送测试不能证明实际游戏中的机位构图、遮挡或当前地图几何正确。Cache 四个旧坐标尤其需要实机预览。本版本提供固定机位切换，不包含自动运镜。
