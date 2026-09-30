# ScoreDeck CS 2.13.0 · 简洁视觉版

以 2.12.1 为基础，将控制台、主 OBS 展示、中场页面和内置模块控制页统一为 ChatGPT 风格的石墨灰、灰白排版、柔和圆角和细边框。

## 使用
完整解压 Windows 压缩包，运行 ScoreDeck CS.exe。不要在压缩包内直接运行，也不要单独移动 EXE；保留完整目录。
迁移原有数据：先关闭旧版和新版程序，将旧目录中的 ScoreDeck CS Portable Data 文件夹复制到新版同名位置。也可在“归档与恢复”中导出、导入完整包。
旧版默认配色自动升级；自定义队伍颜色、透明度、背景视频、素材继续保留。若要统一已经自定义过的颜色，请到“赛事设置”点击“应用简洁配色”。此操作保留素材和透明设置。
更新后刷新已有 OBS 浏览器源。输出地址与端口不变。

## 改动
- 左侧导航分为导播、赛事和工作区，统一线条图标；Ctrl+K 搜索功能，Enter 进入，Esc 清空。
- 直播预览与画面选择并排；推送按钮位于画面选择底部，明确区分待播和 ON AIR。
- 表单、按钮、弹窗、队伍管理、入场设置、赛制管理、归档和赞助商面板统一视觉。
- 主 OBS 页面改为中性背景、简洁卡片和清晰字号，保留各赛制的布局和数据逻辑。
- 中场独立输出改为简洁排版，保留动态背景、自定义内容、透明展示位和 GSI 自动中场。
- VoiceBridge、Replay 内置控制页与 RadarHUD 控制页统一外观；Replay 已重新编译 Windows x64 程序。Radar 的阵营、道具和轨迹辨识颜色保持原语义。
- 预览根据容器真实宽度缩放，适配窗口尺寸；修正赞助商复选框尺寸。
- 完整包仍保存设置和展示素材，仍排除 Replay 回放与 VoiceBridge 录音缓存。

## 验证范围
浏览器实测 13 个栏目、导航搜索、画面推送、主题应用、主输出/倒计时透明、中场输出、1366/980 宽度、预览缩放；Replay 与 VoiceBridge 启停。浏览器无脚本错误。
回归测试 23 项均通过（包括使用同源码构建的 Linux Replay 实测）。Windows EXE 检查为 x64，Electron 主运行时保持原版；未在真实 Windows/OBS/GOTV/TS3 环境进行端到端实测。

## 源码
使用 Node.js 运行 npm start。主 UI 的可编辑代码位于 dist/assets/index-evagatfp.js；新的视觉层为 minimal-2.13.css，容器预览缩放为 minimal-layout.js。模块样式位于各模块的 public/web 目录。Replay 以 Go 1.25.0、GOOS=windows、GOARCH=amd64、CGO_ENABLED=0 编译 cmd/replay。执行 npm test 运行回归测试。
