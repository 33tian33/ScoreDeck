# ScoreDeck CS 2.17.1 · VoiceBridge / Replay 跟随主赛

完整解压 Windows x64 便携包，运行 `ScoreDeck CS.exe`，版本应为 2.17.1。升级前可导出完整 `.sdpack` 备份；关闭旧程序后再运行新版本。

## 设置入口

VoiceBridge 和 Replay 栏目右上角各新增「设置」按钮，位于内嵌模块控制台外部。点击展开主赛队伍预览、跟随开关、两队交换、启动设置和旧配置导入；运行中还可直接打开模块完整设置。再次点击收起。

## 自动对齐

默认开启「跟随当前主赛」。后台每秒检查主赛身份变化，模块启动、重启、切换主赛或赛段、修改队名与主队标后自动同步，无需停留在对应栏目。当前赛段没有主赛或参赛者尚未确定时显示待定队伍并清空旧队标。

- VoiceBridge：主赛 A → Alpha 频道，主赛 B → Bravo 频道，同步全名、简称、颜色与主队标，更新频道展示和新推送的 OBS 语音标签。已在播放的音频保留推送时身份。
- Replay：主赛 A → 开局 CT，主赛 B → 开局 T，同步全名与主队标，继续沿用原有半场、加时换边参数。可在设置里交换开局阵营映射。
- 两个模块分别保存跟随及交换选项。关闭跟随可恢复模块内独立设置；开启时内页队名和队标受保护，避免重复配置覆盖主赛。
- TS3 实际频道绑定、API 凭据、Replay 中继、录制和回放参数不因队伍同步而改变。

队标支持 PNG / JPEG / WebP。Replay 内置 Windows 导播程序已重新编译，向旧 Linux Agent 同步前自动转换为其支持的 PNG/JPEG 与 256 KB 以内尺寸，不要求为了队标跟随替换旧 Agent。内置模块控制台与标签使用离线中文字体。

同步失败会在外部设置中显示原因并重试。修改队伍名称或队标仍统一使用「队伍管理」。

其他 2.17.0 的队伍管理、中文输入与多赛段播出功能保留，详见 `README-2.17.0.md`。

## 源码与验证

新增 `server/integration-identity.cjs` 解析主赛并同步模块；`dist/assets/integration-panel.js` 管理外部设置入口。Replay 修改在 `modules/replay-source`，VoiceBridge 在 `modules/voicebridge`。

运行 `npm run build:ui` 重建 UI。`npm test` 执行 Node 回归；可用 `SCOREDECK_TEST_REPLAY=/绝对路径/Replay` 指定本平台 Replay 程序以完整执行模块集成测试。Go 源码通过 `go build -buildvcs=false ./cmd/replay` 构建，Windows 包使用 `GOOS=windows GOARCH=amd64`。

验证记录见 `VERIFICATION-2.17.1.md`。尚未进行真实 Windows、TS3 双频道、CS2、OBS 及远端录制机的整链路验收。
