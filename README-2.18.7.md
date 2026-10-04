# ScoreDeck CS 2.18.7

- Replay 同步至 33tian33/Project-Replay-in-for-CS2-tournaments 的最新正式发布 **v0.2.5**，以该标签源码构建 Windows x64 ScoreDeck 集成版。
- 支持四位群组码连接、全场精选播出、等待迟到素材追加、自定义 HUD / ZIP HUD 及新版录制端控制；保留主赛队名/队标同步、WebP 队标转换、内嵌页面、进程托管和原有界面样式。
- 半场与全场自动精选继续按回合和击杀发生时间排序，并过滤旧会话、非击杀道具素材与重复事件。半场结束回合可配置；全场列表可排序、移除，编辑后切换手动收集，也可重新开启自动收集。
- RadarHUD 控制页新增「清除缓存」。同时清理原始 GSI、帧文件、内存轨迹和回放状态；显示设置、追踪设置保留，接收端口持续可用。
- RadarHUD 缓存从该批次创建起最多保存 **2 小时**，持续写入和重启均不延长期限。到期整批清理；关闭程序期间的过期缓存在下次启动、恢复使用前清理。清理后重新接收新 GSI。
- 完整包导出同时清除 Replay 全场精选缓存索引。

完整解压 Windows 便携 ZIP 后运行 `ScoreDeck CS.exe`。旧数据在旧目录的 `ScoreDeck CS Portable Data`，升级时可复制至新目录。

Replay 0.2.5 改变云中继协议：配套 Linux 录制端和云中继也应升级至 0.2.5；旧中继启动命令移除 `-credentials`，保留原数据目录。ScoreDeck 不会替你修改远程机器。

来源与校验见 [Replay 上游记录](modules/replay/UPSTREAM.json)，验证范围见 [验证记录](VERIFICATION-2.18.7.md)。真实 CS2 / OBS / Linux 录制和公网中继仍需现场联调。
