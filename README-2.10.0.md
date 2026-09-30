# ScoreDeck CS 2.10.0 · Replay / VoiceBridge 整合版

基于 ScoreDeck 2.9.3，集成 Project Replay 0.2.1 Windows 导播端与 VoiceBridge 0.6.3 CN。原有赛事、入场动画、MVP、RadarHUD、赞助商、导播交接等功能保留。

## Windows 启动

完整解压 Windows x64 Portable ZIP 到可写目录，运行根目录 `ScoreDeck CS.exe`。无需另装 Node、Go 或 npm。不要仅抽取 EXE；resources、DLL 与其他文件必须一起保留。

侧栏新增两个独立页面：

- **Replay 回放**：点击“启动 Replay”，在完整原版控制台内配置会话、中继公网 IP / URL、设备 ID / token、四位群组码、配对、录制节点、OBS、GSI、队伍与 HUD、素材、回合和半场队列、转场、快捷键、自动播出、Demo 联调、校准及日志。
- **VoiceBridge 语音**：点击“启动 VoiceBridge”，完整保留 API 服务与模型配置、CS2 热词表、TS3 插件安装和双连接绑定、两队命名、Windows 静音、缓存、逐人监听、片段修剪审核、筛选、预听、正式输出绑定及导播端延迟。

切换栏目不会卸载已打开的模块页面，后台服务继续运行。可切换“专注模式”扩大控制台，或打开独立窗口。页面中的设置仍按原模块规则保存；不要将尚未保存的输入误认为已落盘。

每个模块均提供启动、停止、重启、端口配置、自启选项和旧版导入。默认不自启，避免首次运行即抢占独立软件端口。模块页面中的 VoiceBridge“重启服务并应用”仍有效。

## OBS 输出

| 模块 | 默认浏览器源 |
| --- | --- |
| ScoreDeck | http://127.0.0.1:17890/output/live |
| Replay | http://127.0.0.1:7788/output.html |
| VoiceBridge | http://127.0.0.1:8787/overlay?output=program |

各自作为独立 OBS 浏览器源，1920×1080 / 60 fps；地址可从对应页面复制。改端口后请同步 OBS。VoiceBridge 首次使用须在原控制台中绑定正式输出；未绑定时拒绝播出。Replay 与 VoiceBridge 播出仍各自受原控制台管理，并未加入自动互斥或自动切换 ScoreDeck 直播栏目。

模块服务仅监听本机。局域网的 ScoreDeck 远程赛事控制保留，但这两页须在运行 ScoreDeck 的本机操作。Linux 录制机、云中继和 TS3 服务器仍须按原软件要求部署；本包整合 Windows 导播端，不包含这些外部服务。

## 端口与退出

Replay HTTP 默认 7788，VoiceBridge HTTP 默认 8787，可以停服后更改。TS3 插件 UDP 固定 8790，与原生插件一致。若旧独立版仍在运行，会明确报告端口占用，不会擅自终止它或接管其会话。

修改 ScoreDeck 主端口或倒计时端口前，请先停止两个模块。主程序退出会通知模块保存并退出；Replay 通过托管标准输入、VoiceBridge 通过 IPC 正常关闭。父进程异常离开时，模块也会收到断开通知。若模块 45 秒未退出会被终止，并在状态中报告。请先结束播出/录制再退出；电脑断电等异常不能保证活动片段完整。

## 升级与配置导入

1. 退出旧版 ScoreDeck、Replay、VoiceBridge，先备份旧目录。
2. 将整合包解压到新目录。要保留 ScoreDeck 赛事与素材，将旧 `ScoreDeck CS Portable Data` 复制到新程序同级目录。它与浏览器缓存是两个目录，不能只复制缓存。
3. 打开对应模块页的“启动设置与旧版配置导入”。Replay 选择旧程序目录或 `replay-data`；VoiceBridge 选择原程序目录。
4. 导入前模块必须已停止。旧目录不会被修改，当前集成数据会改名保留为带时间戳的备份。
5. VoiceBridge 默认导入 `.env`、API 配置、热词预设、队名和缓存设置；勾选后另导入默认 `runtime` 的历史录音。原先指定的外部缓存绝对路径继续使用，请勿删除它。
6. Replay 导入完整数据目录，保留配置、素材和历史，并重定位原数据目录内的素材路径。数据目录外的绝对路径继续指向原位置。
7. 启动模块并检查连接。VoiceBridge 两个 TS3 连接、阿里云密钥、Replay 远端连接与 OBS 仍需在真实环境中确认。

新数据分别保存于 `ScoreDeck CS Portable Data/integrations/replay` 和 `.../voicebridge`，模块启动偏好保存在 `integrations/settings.json`，运行日志也在该目录。归档模块时请备份整个 integrations；ScoreDeck 原“导出赛事与素材 ZIP”不包含模块密钥与录音。

## 来源与适配

Replay 直接取自以下 Release，Windows ZIP 和构建源码 ZIP 均通过同页 SHA256SUMS 校验：
https://github.com/33tian33/Project-Replay-in-for-CS2-tournaments/releases/tag/v0.2.1

Windows Replay 主程序由该源码重新编译，新增可选的托管退出及指定本机 ScoreDeck 端口的页面嵌入支持。独立启动默认继续禁止被嵌入。原 `replay-source.exe`、文档、第三方许可证保留。

VoiceBridge 基于用户提供的 0.6.3 完整包，保留现有 Windows Node、TS3 DLL、音量助手和完整前端，增加数据目录分离、托管停止及实例健康标识。原独立包未修改。

本次修改的 Replay 源码在 `modules/replay-source`。Apache-2.0 与全部第三方许可随包保留。具体验证范围见 `VERIFICATION-2.10.0.md`。

## 源码构建

源码包包括 ScoreDeck 已发布前端 bundle、可编辑的集成面板、服务代码、模块源码与 Windows 运行组件。沿用 2.9.3 的交付结构；并非重新获得一个不存在的上游 React 工程。

- Node 22+：`node scripts/build-integrations.cjs` 将集成面板文件同步至 bundle。
- Go 1.25+：在 `modules/replay-source` 中执行 `go test ./...`，以及 `go build -buildvcs=false -trimpath -ldflags="-s -w" -o ../replay/ProjectReplay.exe ./cmd/replay`（Windows 环境）。跨平台构建 Windows 时设置 `GOOS=windows GOARCH=amd64 CGO_ENABLED=0`。
- Linux 测试二进制名称为 `modules/replay/ProjectReplay`，编译时将输出路径改为该文件。
- `node --test tests/*.cjs radarhud/tests/*.cjs`；VoiceBridge 内执行 `node --test`。
- Replay 输出前端：`node --test tests/hud.test.cjs tests/output.test.cjs`。
- 原可选 `relay-ui.cjs` 依赖另外构建的三端测试夹具，不由上述单元测试调用。
