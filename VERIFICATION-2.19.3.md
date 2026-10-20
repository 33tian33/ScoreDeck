# ScoreDeck CS 2.19.3 验证记录

验证日期：2026-10-21，Windows x64。

- ScoreDeck / RadarHUD 完整 Node 回归 192 项：191 项首次通过；1 项因随机分配到 Fetch 禁用端口失败，单独复验通过。无跳过。
- Replay 集成专项 5 项通过，覆盖托管启停、嵌入来源、配置持久化、队伍同步、金色转场和原生模块请求转发。
- Replay 播放器与 HUD 测试 16 项全部通过。
- Replay Windows 主程序及事件解析器从集成源码重新构建，主程序报告 0.2.11。
- Go 完整回归及 Windows 环境限制详见 [Replay 升级记录](modules/replay/UPGRADE-0.2.11.md)：13 项原有环境依赖失败；`go vet` 与 Linux amd64 / arm64 全包交叉编译通过。
- 页面构建完成。便携包以本地 2.19.2 运行时为基础，包含当前源码和新版内置 Replay；打包脚本逐文件核对 SHA-256 并检查 ZIP 完整性，整包摘要随附件提供。

未执行真实 CS2、OBS 或远程 Linux 双机实录；自动测试不能替代现场验收。发行前另由 GitHub Linux CI 验证 Go 与 ScoreDeck 回归，通过后才公开 Release。
