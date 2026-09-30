# 2.11.0 验证记录

- 基于已交付 2.10.0，未改动 Replay / VoiceBridge Windows 二进制。
- `npm test`：18 项，17 PASS，0 FAIL，1 SKIP。跳过项需本平台的原生 Replay 可执行文件。
- `tests/halftime.cjs`：计时暂停 / 恢复 / 重置 / 幂等开始、地图小分、文字覆盖、素材地址校验、授权 / 版本冲突、素材归档、GSI 快照换边稳定性。
- `scripts/qa-halftime.cjs`：真实 Chromium，运行服务与浏览器处于同一进程树。Replay 受控夹具模拟当前会话半场精选、过期素材过滤、视频 Range，不代表 Windows 实机录制验收。
- 浏览器检查：中场侧栏、未保存表单在换页后保留、轮次、倒计时暂停 / 刷新 / 到零、替换为前瞻页、左右交换、预览静音、RadarHUD 中场嵌入不修改全局设置。无 pageerror。
- `verification/halftime-output.png` 为程序实际渲染，左侧已替换为 ScoreDeck 前瞻，右侧为 RadarHUD；示例队名与 7:5 均为测试数据。
- 程序包 ZIP CRC、源码与便携包应用文件一致性检查通过。保留原 x64 Electron 外壳及各模块运行文件。
- 尚未验证：Windows Electron + OBS 音频设备 + 实际 CS2 / TS3 / 公网中继完整链路。
