# 2.18.5 验证记录

日期：2026-09-30。环境：Windows x64、Node.js 24.19.0、Microsoft Edge 无头浏览器。

- UI 构建：通过。
- 主程序与 RadarHUD：114 项通过，0 失败，0 取消，0 跳过。Replay 集成测试使用用户提供的 2.18.4 源码包内 Windows 可执行文件；本次没有修改 Go 源码。
- 新回归测试覆盖旧 KDA 改名污染、GSI 导入 BAN/UNUSED/无效地图，以及 BP 待选状态。
- 浏览器检查：BO1、BO2、BO3、BO5、待选、空对阵；卡片未超出 1920×1080 画布，无 JavaScript 错误。
- Windows 源码目录不含 node.exe 时，VoiceBridge 启停、重启、设置持久化与队伍身份同步集成测试通过。
- 版本显示：服务和桌面窗口读取 package.json，HTML 和界面脚本同步为 2.18.5。

本地未安装 Go，Go 源码测试交由仓库现有 GitHub Actions 执行；此记录不预先宣称 CI 通过。没有运行真实 CS2、OBS 或 TeamSpeak 联机验收。

Windows 便携版沿用 2.18.4 的 Electron、Node、Replay 及其他原有原生二进制，仅更新本次应用源码、构建产物和说明。
