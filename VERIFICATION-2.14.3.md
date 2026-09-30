# 2.14.3 验证
- tests/director-window.cjs：2 项通过，覆盖真实 main.cjs 中创建窗口路径及持久化尺寸逻辑（Electron API 模拟环境）。
- tests/modules.cjs：VoiceBridge 回归通过；Replay 因 Linux 环境缺少平台程序跳过。
- scripts/qa-ranking-resize.cjs：真实浏览器与 ScoreDeck 服务通过；800×161、1100×181、1366×200、1920×240 均无控件越界和游戏区滚动溢出；双队音频卡片、字体按尺寸缩放；排名切换、持久化、OBS即时同步通过。
- Windows发布包：ZIP CRC、逐文件SHA-256、13个PE文件范围、主程序官方完整哈希与x64架构检查。
- 未执行真实 Windows/CS2 实机测试。
