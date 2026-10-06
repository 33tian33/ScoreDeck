# ScoreDeck CS

CS2 赛事编排与导播工具，集成地图 BP、比分与 KDA、RadarHUD、Replay、VoiceBridge 和 OBS 输出。

当前版本：**2.18.11**。本仓库以 2.18.4 源码包为基准，保留原始模块和历史版本说明。

- 精简观众 BP 输出页：去掉重复标题、BAN/UNUSED 说明、选边提示和底部术语解释；保留赛事、轮次、队伍、地图、禁选类型和开局 CT/T。
- 未选地图使用灰色虚线待选状态；没有队标时仅显示队名，避免重复简称。
- 修复更换 BP 地图时旧 KDA 被改名到新图的问题：已有比分或选手数据的地图须先清空数据再更换，拒绝时保持原数据不变。
- 修复 GSI 将已 BAN、BO2 UNUSED 或无效地图写入待定比赛槽位的问题。
- 修复 Windows 源码启动 VoiceBridge 时缺少内置 node.exe 导致失败：优先使用内置 Node，普通 Node 启动时可回退到当前 Node；Electron 仍使用内置运行时。
- 服务 API 与桌面窗口从 package.json 读取版本；同步更新页面版本号。
- 雷达集成测试禁用自动打开浏览器，避免本机浏览器连接干扰测试退出。

最新更新：新增两个可独立编辑和推送的自定义画布，支持文字、色块、图片与视频；优化输出自适应放大和居中；赛程增加时间排序、小组筛选、搜索和清除时间。详见 [2.18.11 更新记录](README-2.18.11.md)。

集成模块更新（2026-10-06）：Replay 已同步至 **0.2.6**，包含单 HUD、保枪击杀回合归属及连续击杀合并录制/直接切镜修复，保留 ScoreDeck 的队伍同步、精选列表、默认金色转场和导播栏独立变速回放。配套 Linux 录制端需同步升级至 0.2.6，中继协议不变。来源与验证范围见 [Replay 集成说明](modules/replay/README.md)。

## 本地运行

需要 Node.js 22+。启动 Replay 或运行 Go 测试还需要 Go 1.25.0+。主程序不需要安装 npm 依赖。

```sh
npm run build:ui
npm start
```

浏览器地址和 OBS 输出地址以启动日志为准。BP 独立输出路径为 `/output/mapBP`，画布为 1920×1080。

Windows 源码运行 Replay 时，在项目根目录构建：

```powershell
cd modules/replay-source
go build -buildvcs=false -o ../replay/ProjectReplay.exe ./cmd/replay
cd ../..
```

Linux/macOS 将输出文件改为 `../replay/ProjectReplay`。Windows 便携版包含运行时和 Replay，可直接启动。Git 仓库不包含平台运行时、用户数据或凭据。

## 开发与验证

- 界面源码：`ui/`；样式和静态资源：`dist/assets/`。
- 后端：`server/`；回放源码：`modules/replay-source/`。
- 修改界面后运行 `npm run build:ui`，同步生成浏览器脚本。
- `npm test` 验证主程序与雷达。Windows 完整集成测试需设置 `SCOREDECK_TEST_REPLAY` 为 Replay 可执行文件的绝对路径。
- 在 `modules/replay-source` 运行 `go test ./internal/replay ./internal/relay`。
- GitHub Actions 自动构建界面、测试 Go 并运行 Node 集成测试。

2.18.11 本地验证范围与发布包校验见 [验证记录](VERIFICATION-2.18.11.md)。

完整功能说明见 [2.18.4 文档](README-2.18.4.md)，最新变更见 [2.18.11 更新记录](README-2.18.11.md)。历史文档中的发布状态仅代表当时状态。
