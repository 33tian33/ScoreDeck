# ScoreDeck Replay v0.2.11 升级记录

更新日期：2026-10-21。上游：[Project Replay v0.2.11](https://github.com/33tian33/Project-Replay-in-for-CS2-tournaments/releases/tag/v0.2.11)，发布于北京时间 2026-10-21 01:30:45，提交 `e4ce7b00b6be640b8e8638c61813d810cec9b941`。

以 v0.2.10 为基线合并全部 25 个上游变更文件，下载内容逐文件通过 GitHub compare API 的 Git blob SHA-1 校验。四处文本合并冲突分别涉及启动入口、Service 字段及两个依赖文件，已同时保留 ScoreDeck 嵌入配置、WebP 依赖和新版窗口保护、启动 HUD 功能。

保留托管启停、主窗口嵌入、队伍同步、图标和字体、精选列表、默认金色转场及导播单片段变速播放。更新范围为当前工作目录的内置模块、集成版本标记和说明，未修改运行数据、旧发行包或远程节点。

Windows 两个程序均由集成源码构建，参数为 `-buildvcs=false -trimpath`：

- ProjectReplay.exe SHA-256：`eb175d9bc726664c2a56efb8d7e53a9c3db2b45f9870149f2c2906c52342c3fe`
- replay-source.exe SHA-256：`f36d78cf30456280945a3e80a90632f4880e43b45d0bb8df349d365d486e153d`

`UPSTREAM.json` 中的 windowsAssetSha256 为官方发行附件摘要，不是集成 EXE 摘要。

验证结果：

- 程序报告 `Project Replay 0.2.11 windows amd64`。
- ScoreDeck 集成测试 5 项通过，无跳过，包括托管启动和退出、嵌入来源、配置持久化、队伍同步、默认金色转场及原生模块转发。
- Replay 播放器与 HUD 测试 16 项通过，包括独立倍速及停帧恢复透明。
- 完整 Go 测试记录 203 个通过事件（含子测试），仍有与 0.2.10 相同的 13 项环境依赖失败：12 项受 Windows 不支持 Linux 真实采集限制，1 项因本机已有 Steam 安装影响自动发现断言。没有修改平台限制或断言掩盖失败。
- `go vet ./...`、Linux amd64 和 arm64 全包交叉编译通过。
- 未执行真实 CS2、OBS 或远程 Linux 双机实录验收。

上述 13 项为：TestDirectorForwardsPlatformInstructionAndClearsOldPassword、TestSavePlatformCommandAndReconnectKeepsPassword、TestForcedGOTVReconnectCancelsAndWaitsForCamera、TestDirectorCanReconnectWhileBusy、TestNormalGOTVConnectReplacesOldStatus、TestDiscoverSteamConfig、TestCustomHUDSwitching、TestHUDCommands、TestHUDRejectsUnappliedCommand、TestLocalDemoPairDelayAndCancellation、TestHUDInstallationInOBSIsIdempotent、TestAutomaticMappingFromConsoleAndGSI、TestConfigSendsGOTVOnlyWhenEnabled。

原模块备份位于 `../../verification/replay-0.2.11/backup-replay/`，变更源码的更新前副本位于同目录的 `ours/`；测试日志也保存在该验证目录。

云端 Relay 和 Linux Agent 必须同时升级至 0.2.11 并重启，才能修复旧 Relay 的 GOTV 状态接口 403。本次本地替换不会更新远程节点；两端升级时应保留原数据目录和配置。
