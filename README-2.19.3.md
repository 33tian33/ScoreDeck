# ScoreDeck CS 2.19.3

内置 Replay 更新至 **0.2.11**，保留 ScoreDeck 队伍同步、主窗口控制台、精选列表、默认金色转场和导播栏独立变速回放。

- 修复中继 GOTV 状态接口转发；录制端每次启动默认应用 Astra HUD，OBS 尚未就绪时自动重试。
- 新增 Linux 无头 CS2 窗口置顶、最小化恢复和焦点保护。
- 包含此前本地 2.19.0–2.19.2 更新：Replay / VoiceBridge 控制台直接挂载主窗口、网页赛事一键后台同步、网络故障自动重试、8 路资源下载、持久缓存、切换页面及刷新后恢复进度，以及 BO2 BP 和赞助商分页展示。
- 包含 Replay 0.2.10 的调度、玩家映射、拆弹时钟、GOTV 提示和播放停帧恢复修复。

下载 Windows x64 便携 ZIP，完整解压后运行 `ScoreDeck CS.exe`。升级前退出旧程序，保留原 `ScoreDeck CS Portable Data` 数据目录。SHA-256 校验文件随包提供。

**云端 Relay 与 Linux Agent 必须同时升级至 Replay 0.2.11 并重启，才能解决旧中继的 403。** 此 Windows 包不会自动更新远程节点。

验证范围见 [2.19.3 验证记录](VERIFICATION-2.19.3.md)。真实 CS2 / OBS / Linux 双机录制仍需现场核验。
