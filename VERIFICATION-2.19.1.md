# ScoreDeck CS 2.19.1 验证记录

验证日期：2026-10-17，Windows x64。

## Replay 来源与构建

- 最新正式版为 Replay v0.2.10，提交 `99556160dcee590520caa9f5a887f780762cf9bf`；相对 0.2.9 的 25 个上游变更文件均校验 Git blob SHA-1 后进行三方合并。
- 集成 EXE 版本输出为 `Project Replay 0.2.10 windows amd64`；主程序版本更新为 2.19.1，模块显示与实际 API 版本一致。
- 构建 Windows 的 ProjectReplay.exe / replay-source.exe，完成 Linux amd64、arm64 全包交叉编译；Go 静态检查通过。校验值及合并详情见 [升级记录](modules/replay/UPGRADE-0.2.10.md)。

## 自动回归

- ScoreDeck / RadarHUD 完整 Node 回归共 185 项：184 项首次通过，1 项因临时端口被 Fetch 拒绝（bad port）失败。单独复验该文件，4 项全部通过，无跳过。未为这项偶发端口问题修改产品或断言。
- Replay 播放器和 HUD 共 16 项测试全部通过。覆盖正常及迟到素材、转场、透明恢复、断流、媒体时间停滞、视频帧停滞、自动播放失败、重复轮询，以及导播 0.25 / 0.5 / 1 倍速的正常进度。
- Go 全套测试的 13 项失败均依赖 Linux 采集环境或特定 Steam 安装条件；排除这些环境项后的 Windows 适用范围 147 项顶层测试通过，0 项失败。另有 4 项真实 Demo / 媒体工具 / Linux 实录测试因缺少条件跳过，详见升级记录。
- 界面重新构建；播放器与控制台脚本语法检查、`git diff --check` 通过。

## 浏览器验证

使用本机 Edge 验证 Replay 和 VoiceBridge 的主窗口原生控制台：完整设置加载、栏目切换草稿保留、导播延时保存、内部重启、监听 WebSocket、停止与资源清理、专注模式均通过，无页面脚本或模块 CSS / 字体错误。

## 交付与边界

Windows 便携包为 `release/ScoreDeck-CS-2.19.1-Windows-x64-Portable.zip`，以已有 2.19.0 便携运行时为基底叠加当前项目源码和最新集成 Replay。打包脚本逐文件写入 SHA-256 清单并验证 ZIP 与文件内容，整包摘要保存在同名 `.sha256.txt`。

没有连接真实 CS2、OBS 或远程 Linux Agent。A/B 两端需同时升级 Replay 0.2.10，保留各自数据目录与配置；正式录制与播出仍需现场联调。
