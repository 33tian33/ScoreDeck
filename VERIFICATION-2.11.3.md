# 验证 2.11.3

- 旧版本复现：同一 Chromium context 打开导播台与主输出，GET /api/state 超时；两次推送 pending 1/2，主输出保持 prematch。
- 修复后：同一 context 导播台 + 主输出 + 自动中场输出，嵌套预览共用同步。17 次 UI 推送、实际 DOM 断言、入场中断、中场切出、侧栏重建均通过；共 3 条 ScoreDeck SSE，无页面脚本错误。
- GSI 自动中场浏览器测试通过：真实 HTTP 模拟 GSI 输入、透明进退场、比分、倒计时去重及恢复旧画面。
- Node 回归：19 项，18 通过，0 失败，1 因 Linux 环境缺少 Replay 原生二进制而跳过。使用 --test-concurrency=1。
- Windows ZIP：验证 CRC、逐文件 SHA-256、13 个 PE 文件节范围、主 EXE 与官方运行时哈希一致。
- 环境限制：没有 Windows/OBS 原生实机启动验证。浏览器测试使用 Chromium headless。

复现与回归脚本：scripts/qa-scene-sync.cjs。日志位于 verification/*2.11.3.log。
