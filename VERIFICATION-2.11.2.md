# ScoreDeck CS 2.11.2 Windows 修复版

修复旧包主程序被截断导致 Windows 提示“此应用无法在你的电脑上运行”。
完整替换为官方 Electron 37.3.1 Windows x64 运行时。
保留 2.11.1 中场自动输出、独立 Replay、VoiceBridge 与 RadarHUD 全部功能。

完整解压到新目录，然后运行 ScoreDeck CS.exe。适用于 Windows 10/11 x64。
若旧目录已有设置，关闭旧程序后将 ScoreDeck CS Portable Data 文件夹复制到新目录。
中场设置及 OBS 输出说明见 README-2.11.1.md。

验证：官方运行时 ZIP SHA-256 匹配；全部运行时文件逐字节匹配官方包；
所有 EXE/DLL 的 PE 节范围完整；成品 ZIP CRC 及文件哈希验证。
当前环境为 Linux，未执行 Windows 原生启动实测。

官方 ZIP SHA-256: `32ad7124107ffef2aa92abb03175c4a8a60133d50cda338c2ab2917c5efc8c32`
主 EXE 字节数: 205635584
主 EXE SHA-256: `a1296966d5fb832080e277601aa90dba1dc7f3e7ef66e5cfc5d8762022491386`
