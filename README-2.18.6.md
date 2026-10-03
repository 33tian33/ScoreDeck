# ScoreDeck CS 2.18.6

- 赛程与赛果页面新增「隐藏已完成 / 显示已完成 / 只显示已完成」三项筛选。
- 已完成比赛按实际地图提供「导出图1_地图名」等按钮，每次下载一个 JSON 文件。
- JSON 包含赛事、比赛 ID、地图、系列总比分、当图比分、双方队名与队标、当图选手 ID、头像、K / D / A 和 Rating。
- 使用已保存的 GSI 逐图 KDA；未填写的个人数据按 0 导出，Rating 不使用队伍管理中的默认值。
- 队标和头像内嵌为图片数据；最后一个字段 `mapResultImage` 保存当图战绩 PNG 的 Base64 Data URL，文件可独立携带。
- 保留上一版默认配置更新：TestTournament、单支 Test 队伍、自定义赛制启用前锁定赛程入口；新便携目录不自动导入旧存档。

下载 Windows x64 便携 ZIP，完整解压后运行 `ScoreDeck CS.exe`。升级前保留旧目录内的 `ScoreDeck CS Portable Data`，需要延续原存档时将它复制到新目录。

原生运行组件沿用 2.18.5 便携包。尚未进行真实 CS2 / OBS / TeamSpeak 联机验证。
