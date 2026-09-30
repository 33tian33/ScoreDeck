# 2.11.1 自动中场验证

- `npm test`：19 项，18 PASS / 0 FAIL / 1 SKIP；Replay 本机原生集成项沿用跳过。
- `tests/halftime-auto.cjs`：普通回合 / 战术暂停不触发，明确中场触发一次，重复数据与重启去重，手动切走不抢回，新地图 / 热身重置，下半场恢复原画面，禁用开关和陈旧 GSI 不触发。
- `scripts/qa-halftime-auto.cjs`：真实 ScoreDeck + RadarHUD 进程接收 GSI HTTP 数据包，并在 Chromium 同时检查 `/output/live` 与 `/output/halftime-auto`。验证透明 / 显示 / 自动退场、媒体卸载、7:5 比分快照、刷新与重复 GSI 保持原截止时间。
- 处理 RadarHUD 服务未运行时不尝试连接占用端口，避免关闭过程等待无关服务。
- Windows OBS 尚未实机运行；本次验证的是浏览器源内部切换，未使用 OBS WebSocket 或修改 OBS 配置。

- 自动检测改用 `/api/phase` 轻量接口，避免重复传输整场轨迹；真实 GSI → 浏览器流程再次验证通过。
