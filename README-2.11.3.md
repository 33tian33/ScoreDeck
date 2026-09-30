# ScoreDeck CS 2.11.3

修复直播控制推送后不更新、切到入场动画栏才生效的问题。

原因：隐藏的中场控制台及嵌套预览重复打开 SSE 长连接，占满 Chromium 的 HTTP/1.1 同源连接池，导致保存与推送请求排队。
修复：同源内嵌页共用父页面 SDClient 同步连接；页面卸载时取消订阅；中场控制与输出复用 SDClient，不再另开重复 SSE。保持预览和正式推送分离。

使用：关闭旧版，完整解压到新目录，运行 ScoreDeck CS.exe。OBS 主输出使用软件“复制 OBS 地址”提供的 /output/live；升级后刷新已有 OBS 浏览器源一次以加载新版脚本。
如需迁移已有设置，关闭程序后复制旧目录中的 ScoreDeck CS Portable Data 文件夹到新目录。

保留官方完整 Electron 37.3.1 Windows x64 运行时、中场 GSI 自动化、Replay、VoiceBridge、RadarHUD 及所有独立控制页。
