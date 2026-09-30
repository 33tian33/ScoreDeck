# RadarHUD GSI 0.3.11 源码

基于 RadarHUD-GSI-Portable-0.3.10-Windows-x64 修改。

## 新功能

控制台 → 地图楼层：
- 全部层（默认）：显示所有楼层底图与数据。
- 1层（下层）：仅显示下层底图、队员、道具、轨迹、烟雾和火焰。
- 2层（上层）：仅显示上层内容。

支持现有双层地图 Nuke、Vertigo。采用原有高度分界：Nuke z=-495，Vertigo z=11700；等于分界值归上层。单层地图显示完整地图，楼层控件禁用；切回双层地图恢复当前选择。

实时、半场回放和 /output（OBS）共用筛选规则。跨层轨迹按楼层拆成独立折线，避免在拼接底图间连出错误斜线。底图使用原尺寸和原坐标，通过 CSS 裁切隐藏其他层，不自动放大或重新居中。

楼层设置保存在运行中的服务端，页面刷新后恢复；接收器重启后回到“全部层”。

## 启动

安装 Node.js 22 或更新版本，在本目录运行：

```sh
npm start
```

不需要 npm install，没有第三方运行依赖。Windows 也可双击 Start-RadarHUD.cmd。

- 控制台：http://127.0.0.1:23416/
- OBS 浏览器源：http://127.0.0.1:23416/output
- GSI：http://127.0.0.1:31337/gsi

将 config/gamestate_integration_radarhud.cfg 放入 CS2 的 game/csgo/cfg 目录，重启游戏。默认认证 token 为 change-me，与配置文件保持一致。缓存写入源码目录 temp/。

## 源码结构

- backend.cjs：完整可编辑、可运行的后端 JavaScript；源自原便携包自带的合并源码，本包未伪造未提供的原始模块目录。
- public/app.js：控制台与 OBS 的渲染及同步逻辑。
- public/index.html、public/style.css：界面与样式。
- public/assets、public/grenades：现有地图、字体与道具资源。
- config：GSI 配置。
- tests/floors.cjs：楼层回归测试。

本包不包含旧版 Windows EXE；请通过 Node.js 运行修改后的后端，避免误启动未更新的二进制。

## 验证

```sh
npm test
```

5项测试通过：楼层高度边界及队员元数据、跨层断线、单层兼容、实时/回放渲染筛选、实测与估算火焰筛选。渲染逻辑测试使用简化 DOM，不是浏览器截图测试。

另已启动真实后端验证 /api/display 三种设置、SSE 推送和非法值处理。当前环境缺少 Chromium，未完成浏览器视觉检查，也未在真实 CS2 / OBS 环境实测。
