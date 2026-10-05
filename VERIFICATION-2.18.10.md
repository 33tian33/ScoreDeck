# ScoreDeck CS 2.18.10 验证记录

验证日期：2026-10-06，Windows x64。

- 重新构建主界面，应用版本、页面标题和版本文件统一为 2.18.10。
- 使用实际 Replay Windows 可执行文件运行 Node / RadarHUD 回归：143 项通过，0 失败，0 跳过。
- 使用 Go 1.25.0 和已有本地依赖缓存重新构建 ProjectReplay.exe、replay-source.exe。
- Replay / Relay 的 Windows 适用测试通过。完整 Go 测试在本机有 9 项失败：8 项涉及仅允许 Linux Agent 的真实采集/控制路径，1 项 Linux Steam 路径测试在 Windows 上发现了本机 Steam 安装；这些测试没有被修改，Windows 子集显式排除了它们。原始结果保存在构建工作区 verification/release-2.18.10-go.txt，子集结果为 release-2.18.10-go-windows.txt。未宣称完成本次 Linux 实机录制验证。
- Edge 浏览器验证 OBS 设置保存、读取场景、底部说明和窄屏布局；点击控制台及编辑器复制按钮，确认传给剪贴板的地址包含 obs=1。
- 真实短视频分别验证旧版半场、自定义半场、全场片单只播放一遍并返回正确场景。OBS 场景控制使用本机模拟 WebSocket 服务，包含实际 v5 认证测试。
- 覆盖第 13 回合 1:50 返回、冻结时间/无效/过期 GSI 不误触发、重复完成通知、预览隔离、人工切场、空片单、断线返回、重启恢复、接口授权和密码隐藏。

发布前再次运行实际 Replay Windows 可执行文件的 Node / RadarHUD 回归，143 项通过，0 失败，0 跳过；Windows 适用 Go 测试再次通过。GitHub Actions 在 Linux 上运行完整 Replay / Relay 测试、构建原生 Replay 并执行 Node 集成测试，发布流程要求对应提交通过该 CI。

交付包以 2.18.9 官方 Electron 运行时包为基底，覆盖已提交源码与重新构建的 Replay Windows 程序。BUILD-MANIFEST-2.18.10.json 记录准确的 Git 提交，sourceIncludesWorkingTreeChanges 为 false。使用 package-windows.py 和 verify-windows-package.py 检查 ZIP CRC、逐文件 SHA-256、PE 完整性和 Electron 主程序。包内不包含本机用户数据和 OBS 密码。
