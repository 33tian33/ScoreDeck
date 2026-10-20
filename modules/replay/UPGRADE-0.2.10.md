# ScoreDeck Replay v0.2.10 升级记录

上游：[Project Replay v0.2.10](https://github.com/33tian33/Project-Replay-in-for-CS2-tournaments/releases/tag/v0.2.10)，发布于 2026-10-17 22:04:02（北京时间），commit `99556160dcee590520caa9f5a887f780762cf9bf`。

以 v0.2.9 为基线，对比官方两版源码归档后合并全部 25 个变更文件；新版文件的 Git blob SHA-1 均与 GitHub compare API 一致。唯一文本冲突位于 `tests/output.test.cjs` 的播放器 fixture 参数，已同时保留本地倍速和上游视频帧检测选项，并让正常视频帧进度测试覆盖 0.25 / 0.5 / 1 倍速。

保留 ScoreDeck 托管启停、受管队伍、主窗口原生控制台、嵌入 origin/CSP、WebP 转换、字体样式、手动及按时间精选、默认金色转场和导播单片段变速播放适配。Windows EXE 由集成源码重新构建，并非直接替换成上游无适配的 EXE。

新增内容包括 OBS 最低 0.3 秒启动准备、拆弹时钟归一化、分段玩家映射及录制让行、单调时钟调度、GOTV 超时和断流提示、日志轮转、过期事件原因保留，以及输出视频停帧约 3 秒后恢复透明。

使用 Go 1.25.0 windows/amd64，构建参数 `-buildvcs=false -trimpath`。本地定制构建的 SHA-256：

- ProjectReplay.exe：`ccb85e4dca34501316dc3a9b210904252e09e5fa4e0f92e0a1b3c27e67289f1e`
- replay-source.exe：`324b55c918cf48f793281fb2438ef882693bad76a33de75ad86995a92856f3b9`

`UPSTREAM.json` 的 windowsAssetSha256 是 GitHub 正式发行包摘要，不是上述定制 EXE 摘要。

验证：播放器与 HUD 16 项 Node 测试全部通过；主程序完整回归共 185 项，184 项首次通过，1 项因随机分配到 Fetch 禁用端口而失败，该测试文件单独复验 4 项全部通过。没有跳过 Node 测试。真实 Edge 验证主窗口控制台、设置、栏目草稿保留、模块重启与资源清理通过。

Go 全套测试在本机有 13 项环境依赖失败；排除这些已确认的环境依赖后，Windows 适用范围 147 项顶层测试通过，0 项失败。4 项因缺少真实 Demo、FFmpeg/ffprobe 或 Linux 实录环境跳过。`go vet ./...`、Linux amd64 / arm64 全包交叉编译通过。

13 个环境依赖项：TestDirectorForwardsPlatformInstructionAndClearsOldPassword、TestSavePlatformCommandAndReconnectKeepsPassword、TestForcedGOTVReconnectCancelsAndWaitsForCamera、TestDirectorCanReconnectWhileBusy、TestNormalGOTVConnectReplacesOldStatus、TestDiscoverSteamConfig、TestCustomHUDSwitching、TestHUDCommands、TestHUDRejectsUnappliedCommand、TestLocalDemoPairDelayAndCancellation、TestHUDInstallationInOBSIsIdempotent、TestAutomaticMappingFromConsoleAndGSI、TestConfigSendsGOTVOnlyWhenEnabled。其中 TestDiscoverSteamConfig 命中本机已有 D 盘 Steam 安装，其余依赖仅在 Linux Agent 上支持的真实采集锁。未修改平台限制或断言来掩盖失败。

Windows 导播端和 Linux Agent 应同时升级至 0.2.10，保留两端数据目录和配置。未执行真实 CS2、OBS 与远程 Linux 双机实录验证；浏览器演示验证不能代替现场验收。
