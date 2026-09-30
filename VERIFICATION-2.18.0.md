# ScoreDeck 2.18.0 验证记录

日期：2026-09-27。测试使用隔离临时目录与测试队伍，不修改用户赛事。

- Node 回归：`SCOREDECK_TEST_REPLAY=/tmp/ScoreDeck-Replay npm test`，91 项通过，0 失败，0 跳过。
- Go：Replay / Relay 通过。此受限执行环境无法正确验证跨进程 PID 可见性，沿用排除 `TestCS2KillExactProcess`；未将该项记作通过。CI 配置在普通 GitHub Linux runner 中运行完整 Go 测试。
- 原半场收集浏览器回归通过：乱序到达重排为 R1–R12、手动开关与重启恢复。
- 新画面浏览器检查通过：中文输入、半场／全场独立布局、拖动、尺寸保存、全场播出／隐藏、零页面 JavaScript 异常。
- 实际链路集成测试：POST GSI → Radar 30 FPS 状态 → ScoreDeck 自动写入 KDA → 中场触发 → 换边 → 地图 gameover → 全场模式。确认换边后仍是 A 13 : B 11，未知 ADR 保留为空。
- 原生 Replay 实际媒体验证：生成三段有色 MP4 测试视频，乱序入库为 R30、R13、R1；全场列表排序 R1、R13、R30，半场只含 R1。浏览器解码并顺序请求三段视频，支持 HTTP Range 206，半场地址拒绝取用仅属全场的 R30。
- BP：BO1/2/3/5 最终地图数、重复禁选拒绝、已录比分地图保护、并发 BP 冲突验证。
- 画面配置：独立存储、空画布、尺寸边界、素材地址协议、保存冲突保护。
- 地图资源：9 张原始缩略图、9 张 SVG 图名卡片，来源 URL 和 SHA256 内置；运行时不依赖远程图像。
- Windows Replay 已从本次 Go 源码交叉编译。主应用沿用已验证官方 Electron 运行时。
- 发布包执行 ZIP CRC、文件哈希、PE 文件和源码／嵌入应用一致性检查；具体结果见交付时的验证日志。

截图采用测试选手与测试数据，不能作为真实赛事战绩。Replay 视频是测试色块媒体；没有声称已经在 Windows CS2／录制端／OBS 实机联调。

GitHub 连接已完成，但本会话没有获得仓库读写工具、GitHub CLI 或可用授权凭据。已整理本地 Git 仓库和 CI、创建 Git bundle，未创建 GitHub 远端仓库、未推送。
