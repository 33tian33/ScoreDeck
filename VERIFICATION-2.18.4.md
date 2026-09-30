# ScoreDeck 2.18.4 验证记录

新增队员 Steam64 ID 配置、搜索、保存校验、Excel 导入导出与 GSI 身份优先匹配。

- 最终完整 Node 回归：111 通过、0 失败、0 跳过。命令：`SCOREDECK_TEST_REPLAY=/tmp/ScoreDeck-Replay npm test`。
- 新增 7 项测试：17 位字符串精度、全角数字规范化、格式/重复拒绝、缓存优先级、同名冒用拒绝、改名及 CT/T 换边、绑定清理、重复 GSI 账号拒绝、前端输入缓冲与错误提示、真实 HTTP 保存/归档/服务重启。
- 既有 Excel 回归增加 Steam64 文本往返和数字型单元格拒绝；测试环境注入实际使用的共享规则模块。
- 构建后的 JS 语法检查、共享规则一致性及 git diff 空白检查通过。
- 一轮完整测试出现既有 `tests/modules.cjs` VoiceBridge 取消主赛跟随后立即写入返回 409 的偶发失败；该模块单独复测 3/3 通过，最终完整回归 111/111 通过。本次没有修改 VoiceBridge 跟随逻辑，仍保留这一时序风险记录。
- Windows 包将核验 ZIP CRC、全部文件 SHA-256、13 个 PE 文件和主程序原始哈希，并核验内嵌应用与源码一致。
- 未进行真实 Windows CS2/GOTV/OBS/TeamSpeak 联机验收；前端行为通过实际组件的 VM 测试，未进行浏览器视觉验收。

Git bundle 保留完整历史和 v2.18.4 标签；本次未上传 GitHub。
