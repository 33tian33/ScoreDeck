# 2.10.0 验证记录

日期：2026-09-26。测试环境：Linux / Node 24、Go 1.27.1、Chromium 154；交付平台：Windows x64。

- Replay 0.2.1 原 Windows ZIP 与对应构建源码 ZIP：匹配官方 SHA256SUMS。
- ScoreDeck 原有回归及新模块测试：15 项通过。涵盖导播交接、状态同步、统计、赛制、RadarHUD、完整模块页面可达、端口占用拒绝、生命周期、VoiceBridge 页面内重启、延迟设置保存、旧配置导入与退出落盘。
- VoiceBridge 原有测试：52 项通过，保留原语音/流式识别协议模拟、热词、片段、队名等覆盖。
- Replay HUD 与播出前端：11 项通过。
- Replay Go：除 `TestCS2KillExactProcess` 外全部通过。该测试在当前 Linux 环境中失败（非游戏辅助进程被观察为已退出）；未声称已修复或通过。此测试针对 Linux 录制端的进程识别路径，Windows 导播端使用单独的平台实现。
- Chromium 实际页面：Replay 的 25 个会话配置输入存在；两模块完整控制台能嵌入；切换栏目保留未提交输入；VoiceBridge 页面内重启生效且 12.5 秒导播延迟保持；专注模式正常；无捕获到的 JavaScript 异常。
- JS 语法与包内 Windows PE 架构检查通过。Replay Windows x64 主程序重新交叉编译，其余 Windows 原生依赖复用已发布文件。

未完成：在真实 Windows 桌面中运行 Electron / TS3 插件 / Core Audio / OBS 的联调，以及使用真实云中继、CS2、阿里云和 DeepSeek 的端到端录制与播出。Linux 浏览器及模拟测试不能替代这些现场验证。

集成时保留原软件的功能与独立输出，不自动合并两套播出队列，不自动同步 ScoreDeck 队名到 Replay 初始 CT/T 阵营或 VoiceBridge 频道，以免覆盖导播明确配置。
