> 历史源码版说明：0.4.1 国内接口版的语音识别已改为阿里云百炼，请以根目录 API-SETUP-CN.md 为准，下面的 OpenAI 默认配置不再适用。

# VoiceBridge 声场切片 0.4.0

TeamSpeak 双频道语音导播：玩家独立 PCM → 自动识别 → 语义分段 → 真实片段 WAV → 预听 / OBS 播出。

这是可运行的源码版，包含 Node 服务、网页导播台、TS3 API 26 C++ 插件源码及测试。不包含编译好的 Windows DLL，也不包含 API 密钥。

## Windows 快速开始

1. 安装 **Node.js 22 或更新版本**。服务没有 npm 第三方依赖，不需要 `npm install`。
2. 解压到一个新的目录，不要直接覆盖正在运行的 0.3 项目。
3. 将 `.env.example` 复制为 `.env`，或双击 `Configure-API.cmd` 自动创建并打开。
4. 填写 `OPENAI_API_KEY`。可选填写 `DEEPSEEK_API_KEY`。保存后双击 `Start-VoiceBridge.cmd`。
5. 打开 <http://127.0.0.1:8787>。
6. 按下文重新编译并安装 **0.4 插件**，然后分别绑定两个 TS 连接。
7. 在 OBS 中添加浏览器源 <http://127.0.0.1:8787/overlay>，分辨率 1920×1080。不要勾选“来源不可见时关闭”。
8. 玩家讲话后，观察“音轨数量”“语音识别已完成”“音频就绪”逐步出现；点击“预听”或“播出至 OBS”。

命令行启动与验证：

```bash
npm test
npm start
```

Linux/macOS 的 Node 服务可使用 `./start.sh`。TS 客户端插件需在对应平台用官方 SDK 编译；本包没有 macOS 实机验证。

## 采用的 API

### 语音识别：OpenAI Whisper

- 默认 `POST https://api.openai.com/v1/audio/transcriptions`，模型 `whisper-1`。
- 使用 multipart WAV、`verbose_json`、`timestamp_granularities[]=segment`，默认语言 `zh`。
- 选择依据：该接口提供片段时间码，可以直接映射回本地录音；说话人由 TS 身份提供，无需额外声纹分离。
- 实现为**短句分块识别**，不是逐字实时 WebSocket：每位玩家约 800ms 无有效语音后提交，连续讲话最长每 8 秒提交一次。
- 默认最多 2 个并行请求；429 / 服务端错误 / 网络错误自动重试，最多 3 次；失败任务可在页面点击重试。
- 仅有中文文字、没有 `segments` 时间码的兼容端点不能直接替换。若更换 ASR_BASE_URL，应确认相同协议。

官方接口说明：<https://developers.openai.com/api/docs/guides/speech-to-text>

### 语义分段：DeepSeek

- 默认模型 `deepseek-flash`，非思考模式，超时默认 3500ms。
- 只处理尚未提交的话语窗口；模型只能引用话语 ID，音频起止位置由服务器计算。
- 无密钥、超时或错误均回退本地规则；ASR 与音频采集不依赖 DeepSeek 成功。

官方接口说明：<https://api-docs.deepseek.com/>

配置密钥后，语音短句会发送到所配置的 ASR 服务，识别文本会在启用 DeepSeek 时发送给其接口。密钥仅从本机 `.env` 或环境变量读取，不通过网页下发。环境变量优先于 `.env`。修改配置后需重启服务。

## 两个 TeamSpeak 频道

本插件不能让一个连接跨频道收音。需要两个独立 TS 连接，每个进入一个目标频道。可以使用一个客户端中的两个连接标签页；若使用两个进程，各自加载插件也可使用同一个本机 UDP 入口，服务端按来源端口与采集实例区分。

建议使用两个独立的录音身份，麦克风静音，保留接收音频。服务器必须允许这两个连接进入目标频道。确认两个标签页都持续收到音频。

在第一个连接中：

```text
/voicebridge bind channel-alpha
```

在第二个连接中：

```text
/voicebridge bind channel-bravo
```

其他命令：

```text
/voicebridge status
/voicebridge unbind
/voicebridge rate 48000
```

一个频道不能绑定到多个采集连接；检测到重复绑定时服务端暂停该频道入库并提示。
插件每 2 秒发送绑定心跳；超过 6 秒无心跳视为离线。断线后插件解除该连接绑定，重连后需重新执行 bind。0.4 尚未自动创建 TS 连接或持久化连接绑定。

只有远端玩家的接收音频会进入插件回调；录音账号自己的麦克风音频不在该路径内。

## 编译 0.4 插件

需要 Visual Studio C++ 工具、CMake、**官方 TeamSpeak 3 Client Plugin SDK API 26**，以及 64 位 TS3 客户端。

```bat
Build-Plugin-Windows.cmd "C:\src\ts3client-pluginsdk-26"
```

脚本强制 x64，生成 `native-plugin\build-win64\Release\voicebridge.dll`。
关闭 TS3 后，复制为客户端插件目录下的 `voicebridge_win64.dll`。常用目录为 `%APPDATA%\TS3Client\plugins`；如你的客户端使用不同配置目录，以实际插件目录为准。

重启 TS3，在插件列表确认版本为 **0.4.0**。不要将仓库的 mock SDK 构建产物安装到真实 TS3。

Linux 编译见 `native-plugin/README.md`。

## 使用行为

- **新建真实会话**：保存旧会话并切换新的录音目录；旧录音不删除。
- **运行演示**：切换为独立演示会话，用内置合成音验证页面、片段和播放；演示期间不会把 TS PCM 混入演示。
- **提交尾段**：先封装尚未结束的玩家短句；若识别仍有排队或失败任务，会要求等待或重试，避免漏掉较晚返回的玩家话语。
- **预听**：在导播浏览器播放完整片段 WAV；播出前停止本地预听。
- **播出至 OBS**：要求至少一个输出页面在线；显示 LOADING，收到输出页面 started 回执后才显示 ON AIR，ended/error 后回到 READY。
- 同时打开多个输出时，播出到最先注册且仍在线的页面。正式播出前关闭额外调试预览页，以免目标是调试页。
- 普通浏览器可能限制自动播放；OBS 应允许源音频播放。`/overlay?debug=1` 有音频启用按钮。
- 字幕按话语时间显示，重叠说话可同时显示多条；不是逐词字幕。

## 存储与恢复

```text
runtime/
  current.json
  sessions/<sessionId>/
    session.json
    state.json
    <trackId>/<10秒块编号>.pcm
    asr/<jobId>.json
    asr/<jobId>.wav
    clips/<clipId>.wav
```

- 录音标准化为 48kHz / 单声道 / 有符号 16 位小端；每位玩家单独分块存储。
- 新会话、采集实例及玩家身份隔离；插件在活动话语期间使用累计采样位置，并在停顿后重新对齐。
- 原始数据按时间位置写入；缺失区间在读取时补零。重复或乱序旧包不会覆盖新数据。
- 片段混音按峰值缩放，防止多人叠加导致整数溢出；预听与 OBS 共用同一份文件。
- 正常重启自动恢复最后一个会话、已提交片段和持久化识别任务。先无密钥录音、后配置密钥重启，可以继续处理已封装的任务。
- 正常退出会写入状态；异常断电可能损失最后一次状态保存之后的内容，尤其是尚未封装的短句。不是数据库事务级恢复。
- 每会话默认最多写入 8GiB PCM，最多 200 个待处理 ASR 任务、20000 条话语。达到上限会提示；ASR WAV 和片段 WAV 额外占用空间。
- 0.4 不会自动删除旧会话。长时间比赛前检查磁盘，结束后可备份并手动清理旧会话目录；不要删除当前使用中的会话。

## 外部话语接口

读取 `/api/state` 获取当前 sessionId 后，可 `POST /api/utterances`：

```json
{
  "sessionId": "从 /api/state 获取",
  "channelId": "channel-alpha",
  "id": "u-100",
  "speakerId": "ts-uid",
  "speakerName": "北风",
  "startMs": 12840,
  "endMs": 14620,
  "text": "从左边绕过去。",
  "stable": true,
  "revision": 1
}
```

时间必须属于当前会话录音。临时结果可使用同 ID 和更高 revision 更新；已提交段落不自动重写。旧 sessionId 被拒绝。只提交文字、没有对应录音，不会生成有效真实播出音频。

## 本次验证范围

详见 `VALIDATION.md`。自动测试覆盖真实 PCM 数据路径和模拟 API 协议，不能替代目标机器上的 TeamSpeak/OBS 实测。未使用真实付费 API 密钥进行在线转录。
