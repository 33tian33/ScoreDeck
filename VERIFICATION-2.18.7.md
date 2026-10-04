# ScoreDeck CS 2.18.7 验证记录

验证环境：Windows x64，Node.js 24.19.0，Go 1.25.0，Edge 无头浏览器。日期：2026-10-04。

- Replay v0.2.5 Windows ZIP 已下载，SHA-256 与 GitHub Release 记录一致。发布标签对应提交 `9031004324dca6d87cb49a59ca4bfa45c6571122`。
- 使用发布标签源码构建 `modules/replay/ProjectReplay.exe`，保留 ScoreDeck 启停、实例健康检查、内嵌来源限制、设置面板消息、队伍跟随和 WebP 转换。
- ScoreDeck / RadarHUD：122 项 Node 测试全部通过，无跳过；包含实际 Windows Replay 启停、旧数据导入、主赛身份切换、端口、输出、缓存清理与 GSI 持续接收。
- Replay 网页 HUD / 输出：11 项 Node 测试全部通过。
- Replay / relay：Windows 可执行范围的 Go 回归通过；`go vet ./...` 通过。9 项依赖 Linux Agent 操作或真实 Steam 安装发现的上游测试在 Windows 不适用，本次排除并保留测试源码供 Linux CI 执行，未宣称 Windows 全量 Go 测试通过。
- 缓存测试用可控时钟模拟两小时边界、重启和休眠，验证持续写入不延长有效期；实际 HTTP 测试验证手动清理、并发清理、跨域拒绝、文件流关闭、内存/回放归零及重新接收 GSI。未实际等待两小时。
- Edge 实测清除缓存按钮、清理成功反馈和 OBS 输出隐藏控制项；Replay 0.2.5、全场精选、新版群组码设置、主赛锁定队名均可用，无页面 JavaScript 错误。
- Windows HUD ZIP 测试发现新解压目录偶发短暂占用，增加只针对 Windows 权限占用的有限重试（最多约 0.5 秒）；其他错误原样返回。
- 修复端口测试自身 TCP 连接未完全关闭导致的挂起；此变更仅涉及测试。

便携包构建：`python scripts/package-windows.py --base release/ScoreDeck-CS-2.18.6-Windows-x64-Portable.zip`。保留原 Electron / Node / VoiceBridge 运行时，以当前源码和新构建 Replay 覆盖；新包包含逐文件 SHA-256 清单。发布包校验使用 `scripts/verify-windows-package.py`。

未执行真实 CS2 / GOTV / OBS 录制或远程 Linux、公网中继联调。使用云中继时，录制端与中继需同步升级为 0.2.5。
