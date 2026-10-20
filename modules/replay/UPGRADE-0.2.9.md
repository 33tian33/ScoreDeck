# ScoreDeck Replay v0.2.9 升级记录

上游：33tian33/Project-Replay-in-for-CS2-tournaments，正式版 v0.2.9，发布于 2026-10-17T08:07:13Z，commit 0c1e9a494d2c347a54f5d74373bb6669220ded20。

以 v0.2.6 为基线对 141 个上游变更文件进行三方合并；归档中全部 141 个文件的 Git blob SHA-1 均与 GitHub compare API 一致。新增 Astra HUD（字体、雷达、武器图标随程序嵌入）、玩家映射、连续击杀片段合并、GOTV 快捷重连和对应回归测试。

保留 ScoreDeck 生命周期、受管身份、嵌入 origin/CSP、设置消息、WebP 转换、字体样式、手动/按时间精选与导播片段播放适配。三个文本冲突位于 service.go、http.go、web/app.js，均同时保留本地适配和上游功能。

使用 Go 1.25.0 windows/amd64 构建 ProjectReplay.exe 和 replay-source.exe（-buildvcs=false -trimpath）。本地定制构建的 SHA-256：

- ProjectReplay.exe: c8837b3bfc0136bf37c7c07024de47250078582b5cd835656bc5ffac301d2a36
- replay-source.exe: f2093381594f8dd25697a62ef3cb524be096e860098ea1745c18c8084b14608c

UPSTREAM.json 的 windowsAssetSha256 是上游发行包校验值，并非定制 EXE 校验值。

验证：node --check web/app.js、git diff --check 通过。Go 全套测试在 Windows 执行，12 项环境依赖测试失败；排除这 12 项后其余全部通过（internal/replay 13.070s、internal/relay 1.208s）。其中 11 项依赖 Linux Agent 的真实采集锁，Windows 按设计拒绝；TestDiscoverSteamConfig 因本机已有 D 盘 Steam 安装命中而不符合 Linux 临时目录测试预期。未修改平台限制或测试断言来掩盖这些失败。

排除项：TestDirectorForwardsPlatformInstructionAndClearsOldPassword、TestSavePlatformCommandAndReconnectKeepsPassword、TestForcedGOTVReconnectCancelsAndWaitsForCamera、TestDirectorCanReconnectWhileBusy、TestDiscoverSteamConfig、TestCustomHUDSwitching、TestHUDCommands、TestHUDRejectsUnappliedCommand、TestLocalDemoPairDelayAndCancellation、TestHUDInstallationInOBSIsIdempotent、TestAutomaticMappingFromConsoleAndGSI、TestConfigSendsGOTVOnlyWhenEnabled。

未在真实 Linux Agent、CS2 与 OBS 环境进行端到端录制验证；GOTV 快捷重连要求 A/B 两端均升级至 0.2.9。
