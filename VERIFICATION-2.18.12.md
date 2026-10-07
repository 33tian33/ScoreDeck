# ScoreDeck CS 2.18.12 发布验证

日期：2026-10-08。

- 前端重新构建，版本号统一为 2.18.12。
- 设置 SCOREDECK_TEST_REPLAY 指向内置原生 Replay 后，运行 `node --test tests/*.cjs radarhud/tests/*.cjs`：171 项通过，0 失败，0 跳过。工作区日志：verification/release-2.18.12-node.txt。
- 新增 13 项 GSI 战绩回归，覆盖结束时每队一个未知 ID 的首发排除法、多未知 ID 留空、提示与原始战绩保存、重载及编辑器空值、BO1/2/3/5 多图隔离、逐图手动优先、旧窗口保存保护、重复/不完整结束包、系列赛提前结束，以及管理端和导播输出的提示隔离。
- 现有真实本机 Radar GSI → 战绩保存 → 输出 API 集成测试通过；Steam64、换边、BP、赛事流程、导出、远程保存和原生 Replay 集成回归均通过。
- BO1 文本导入验证 A/A/B/B/B/A 禁图归属、系统留下 Mirage、B 队 CT / A 队 T；覆盖 BO3、全角括号、不换行空格、独立选边行及后端原子校验。
- 打包使用 scripts/package-windows.py：便携包基于 2.18.11，应用文件来自本次干净 Git 提交；生成逐文件 SHA-256、构建清单及 ZIP 校验文件，不包含用户数据目录。
- 发布前使用 scripts/verify-windows-package.py 检查 ZIP CRC、逐文件摘要、PE 文件完整性及主程序；发布脚本要求远程 main、构建清单和当前提交一致，并等待该提交的 GitHub Tests 工作流成功后上传、核对远端摘要并设为最新 Release。
- 本次未进行浏览器视觉检查或真实 CS2 / GOTV / OBS 联机验证。模拟控制台和 GSI 测试不能证明真实 GOTV 镜头已经移动。
