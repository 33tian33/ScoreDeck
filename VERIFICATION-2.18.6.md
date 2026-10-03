# ScoreDeck CS 2.18.6 验证记录

- Windows Node 自动测试 119 项全部通过，零失败、零跳过；包含原生 Replay 集成测试。
- 测试命令：`node --test --test-force-exit --test-timeout=60000 tests/*.cjs radarhud/tests/*.cjs`，设置 `SCOREDECK_TEST_REPLAY` 指向便携包内 Replay。
- Edge 浏览器验证通过：三种完成状态筛选、BO3 两图结束时仅显示两个导出按钮、逐图 JSON 下载、KDA / Rating 独立取值、缺失值为 0、队标与头像内嵌、最后字段包含有效 1600 像素宽 PNG。
- 检查生成的战绩图，队伍、队标、比分、选手与统计布局显示正常。
- 已重新构建 UI。便携包沿用 2.18.5 原生运行组件，源码与界面更新到 2.18.6。
- 未进行真实 CS2 / OBS / TeamSpeak 联机验证。
