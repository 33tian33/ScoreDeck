# ScoreDeck CS 2.18.8 验证记录

验证日期：2026-10-05。环境：Windows x64、Node.js 24.19.0、Go 1.25.0、Edge 无头浏览器。

- 重新生成前端构建产物，以当前 Replay 源码重新构建 Windows x64 `ProjectReplay.exe`。
- ScoreDeck / RadarHUD：`node --test --test-concurrency=1 tests/*.cjs radarhud/tests/*.cjs`，133 项通过、0 失败、0 跳过，包含实际 Windows Replay 生命周期、默认转场、跨组比较器和队伍跟随时序回归。
- 并发测试发现队伍自动跟随关闭与后台同步重叠的问题，已修复为显式设置等待当前同步结束再应用最新设置，并添加确定性的回归测试。另一次并发运行遭遇 Windows 临时导入目录重命名 EPERM，最终串行完整测试通过。
- Replay 网页 HUD / 输出：`node --test tests/*.test.cjs`，12 项全部通过；包含倍率仅应用于单段回放、转场保持原速和普通回放恢复原速。
- Replay / relay：Windows 适用范围 Go 回归通过，`go vet ./...` 通过。沿用 2.18.7 的平台边界，排除 9 项依赖 Linux Agent 行为或本机 Steam 安装发现的测试；不宣称 Windows 上全量 Go 测试通过。
- 实际 Edge 浏览器验证：显示最新素材、预览视频保持暂停、倍率按钮不触发播出、点击视频从原生 Replay 输出以 0.25 / 0.5 倍速播放、播出中修改倍率只影响下一次点击、普通回合回放仍为 1 倍速、媒体 Range 返回 206。800 / 1100 / 1920 像素窗口下中央预览与倍率按钮完整可见，无浏览器脚本错误。
- `Replay-gold.mp4` 与用户提供文件 SHA-256 一致：`7669a71ab69e973ea76a230ad2e3c8f06e67cc3ccbf7303aae6b906543b812e5`。默认转场导入、重启保留、旧存档空转场补齐及自定义转场保留均通过原生 Replay 测试。

便携包以 `ScoreDeck-CS-2.18.7-Windows-x64-Portable.zip` 为运行时基底，使用 `scripts/package-windows.py` 覆盖当前源码、前端、素材和重新构建的 Replay；包含当前未提交改动，并在构建清单中明确记录。ZIP 包含逐文件 SHA-256 清单和构建记录，校验脚本为 `scripts/verify-windows-package.py`。

未执行真实 CS2 / GOTV / OBS 录制、远端 Linux 或公网中继联调。Replay 中继与录制端仍须使用匹配的 0.2.5 版本。
