# CS2 热词预设 v1 · 资料与选择

核对日期：2026-09-24。首版针对中文队内语音，收录七图常见中文口头报点、少量英文原词及通用战术/装备词。不同队伍的叫法可能不同，预设只提供转写偏置，不做文字强制替换。

- Valve 2026-07-08 更新：Cache 加入现役图池，Overpass 移出。<https://store.steampowered.com/news/posts/?appids=730&enddate=1783633575>
- CS2 报点参考与位置图：<https://totalcsgo.com/callouts>；Cache 细分位置：<https://totalcsgo.com/callouts/cache>。
- 新版 Cache 报点补充：<https://www.thespike.gg/counter-strike-2/maps/cache>。
- 阿里云预编译热词列表：Paraformer 每表最多 500 条、每账户最多 10 表，创建列表免费；模型需匹配。<https://help.aliyun.com/zh/model-studio/improve-asr-accuracy>
- 阿里云创建/更新 HTTP API 和北京地域工作空间域名：<https://help.aliyun.com/zh/model-studio/vocabulary-http-api>。
- Paraformer 实时流式请求的 `vocabulary_id` 参数：<https://help.aliyun.com/zh/model-studio/paraformer-client-events>。

词表位于 `data/cs2-hotwords-v1.json`。324 条去重词汇由本项目选择、归纳和调整为中文队内常见称呼；地图名称及通用术语重复时以较高权重保留。官方报点的英文名称与队伍口头中文简称不是严格一一对应，使用者可按自己的比赛录音迭代。
