# 0.4 数据约定

- 连接身份：本机 UDP 来源地址/端口 + TS serverConnectionHandlerID。
- 采集实例：来源地址/端口 + TSVB flags（0.4 插件随机 nonce）。
- 玩家身份：TS UID，尚未收到元数据时暂用 clientId。
- 频道：channel-alpha / channel-bravo。一个逻辑频道只允许一个在线采集连接。
- 存储：会话目录内玩家独立的 10 秒 PCM 分块；统一 48kHz 单声道采样位置。
- ASR：每位玩家短句独立上传；API 返回片段时间，服务端换算会话时间。
- 语义模型：只给话语 ID；已提交片段 ID 固定。
- 输出：服务端生成独立 WAV，OBS 从 0 秒播放，不再 seek 演示母带。

旧 0.3 插件没有持续绑定心跳，不适合作为 0.4 的长期采集端；请重新编译插件。
