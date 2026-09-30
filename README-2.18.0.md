# ScoreDeck CS 2.18.0

CS2 导播工作台：多赛段赛事、Replay、RadarHUD、VoiceBridge、比赛管理与 OBS 图形输出。

## 本次新增

- **全场精选**：Replay 自动收集当前会话、当前地图 R1 至最后一回合的已完成击杀视频，含加时；按回合和事件时间排序，自动去重。半场仍为 R1–R12。全场收集不受“半场手动编排”影响。
- **自动全场播出**：收到新鲜 GSI `gameover` 且两队比分不同后，一张地图只触发一次。与中场共用 `/output/halftime-auto`，无需增加 OBS 地址。切换新地图／热身后按自动退场设置隐藏。判定是“当前地图结束”，不是 BO 系列赛全部结束。
- **独立画面编辑**：侧栏“半场 / 全场精选” → “半场 / 全场画面编辑”，或 `/highlights`。两套独立 1920×1080 画布，支持添加、删除、复制、移动、右下角缩放、尺寸精确输入、图层顺序、透明度、字号、颜色与素材导入。允许删除所有元素。
- 元素包括 Replay、Radar、赛程／积分／聚焦／当图战绩等 ScoreDeck 页面、两队独立全名／简称／队标／小局比分、地图名称／地图图标／BP、标题、轮次、倒计时、文字、图片、视频。
- **人工 BP**：每场比赛的“地图 BP / GSI 当图数据”自动随 BO1／2／3／5 切换七步模板；BO2 固定两图，剩余一图不使用。保存 BP 会同步地图名称，禁止重复禁选及覆盖已有比分的地图。
- **GSI 逐图 KDA**：仅采集已启用赛事的当前主对阵。选手名与队伍选手 ID 完全匹配时自动绑定；也可“读取 GSI 选手 / 绑定”手动绑定 SteamID。通过选手身份追踪换边，避免 CT/T 对调写反队伍。比赛管理内保存每图 K/D/A，原有手动数据编辑继续可用。需要手动更正时先关闭本场 GSI 自动填写。
- **当图战绩**：直播控制新增独立输出 `/output/mapStats`，可推到 `/output/live` 或加入精选画布。默认跟随 GSI 当前地图，导播也可选择历史地图。采用地图背景、中央比分、双队镜像选手表布局。
- 9 张内置地图卡片均为地图底图与地图名组合；来源见 `docs/MAP-ASSETS.md`。

## 播出方式

1. 启动 Replay 和 RadarHUD，并按现有流程接入观察者 GSI 与回放录制链路。仅游玩者 GSI 通常不能提供双方全员数据。
2. 在比赛管理设定主对阵，录入 BP，并检查选手绑定。收到数据后逐图表格显示最近采集时间。
3. 在 OBS 添加 1920×1080 浏览器源：`http://127.0.0.1:17890/output/halftime-auto`（端口以控制台实际地址为准），放在游戏捕获上方。
4. 在画面编辑器分别编辑两套画面，点击“保存画面”；可立即播出测试。自动中场开关在播出控制中，全场开关在画面编辑器中。
5. 正常比赛时共用输出透明，中场显示半场画面，地图胜利后显示全场画面。主输出 `/output/live` 不会被强制切换。

刚打开编辑器时可预览新默认布局；保存后启用自由画布。未保存过画布的旧存档继续使用原中场布局，全场使用新默认布局。画布保存具有版本冲突保护。

Replay 列表仅含已经生成并可读取的击杀视频，不会把仍在录制／下载的任务当作成片。缺失素材不会阻止比赛结束事件触发；新完成素材会继续进入播放列表。默认循环播放，可在元素属性关闭循环。素材就绪后从第一条开始计时，避免加载耗时跳过开头。

Radar 使用所选半场的已录制轨迹，有独立半场选择；不宣称它与每个击杀镜头精确同步。

普通 CS2 GSI 提供击杀、死亡、助攻，不保证提供整图伤害，因此没有有效 ADR 时显示“—”，不伪造 ADR。GSI 自动采集不自动宣布整个赛事的晋级或冠军，系列赛完赛仍由比赛管理确认。

## 源码与 Git

建议 Node.js 22+、Go 1.25.0。运行时不用 npm 第三方依赖安装。

```sh
npm run build:ui
npm start
```

非 Windows 开发需先构建本机 Replay 到 `modules/replay/ProjectReplay`：

```sh
cd modules/replay-source
go build -buildvcs=false -o ../replay/ProjectReplay ./cmd/replay
```

构建 Windows Replay：`GOOS=windows GOARCH=amd64 go build -buildvcs=false -o ../replay/ProjectReplay.exe ./cmd/replay`。

源码目录已初始化 `main` 分支，并配置 `.gitignore`、`.gitattributes` 和 GitHub Actions 测试。Git 不收录运行数据、凭据、Windows/Node 可执行文件与发布压缩包；Windows 便携版包含所需运行时。`modules/voicebridge/bin/node.exe` 等二进制请使用便携版，不作为源码仓库内容。

源码说明：既有主界面是上游提供的可读打包 JavaScript；其可维护入口为 `ui/main-runtime.js`，并非恢复了不存在的原始 TSX 工程。新增界面位于 `ui/`、`dist/assets/halftime/`；服务端位于 `server/`；Replay Go 源码位于 `modules/replay-source/`。执行 `npm run build:ui` 重建主界面。

可用附带 bundle 恢复完整 Git 历史：

```sh
git clone ScoreDeck-CS-2.18.0.bundle ScoreDeck-CS
cd ScoreDeck-CS
git remote remove origin  # 移除指向本地 bundle 的临时 origin
```

GitHub 上传准备完成，但本轮 GitHub 连接没有暴露仓库读写工具，未创建远端仓库、未推送。已登录 GitHub CLI 时可运行：

```sh
gh repo create ScoreDeck-CS --private --source=. --remote=origin --push
```

Windows 也可运行 `scripts/publish-github.ps1`。脚本默认创建私有仓库，不覆盖已有远端历史。

## 验证

详见 `VERIFICATION-2.18.0.md`。截图为受控测试数据，不是实场赛果。Windows 上 CS2、录制端、OBS 的完整实机演练仍需在播出环境验收。
