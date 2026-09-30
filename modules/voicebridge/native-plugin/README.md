# VoiceBridge 0.4 原生插件

目标：TeamSpeak 3 Client Plugin SDK API 26，C++17。

Windows 请使用项目根目录的 `Build-Plugin-Windows.cmd`，强制 x64。构建和安装见根目录 README。

Linux：

```bash
cmake -S native-plugin -B native-plugin/build -DTS3_PLUGIN_SDK_ROOT=/path/to/ts3client-pluginsdk
cmake --build native-plugin/build --parallel
ctest --test-dir native-plugin/build --output-on-failure
```

只有开发测试时可以使用 mock：

```bash
cmake -S native-plugin -B native-plugin/build-mock -DVOICEBRIDGE_USE_MOCK_SDK=ON
cmake --build native-plugin/build-mock
```

mock SDK 只验证本仓库声明的接口表面，不具备真实 SDK ABI，不得安装 mock 构建的插件。

## 0.4 改动

- 编译目标版本 0.4.0，Windows 拒绝 32 位配置，MSVC 使用 UTF-8。
- 活动话语使用累计采样位置；停顿后重新对齐单调时钟。固定 128 槽时钟表，在现有传输锁内更新。
- TSVB 头的 flags 字段在 0.4 表示采集实例随机 nonce，用于防止重启后复用旧音轨。
- 绑定心跳每 2 秒发送；断线主动解除绑定；一个进程不能重复绑定同一频道。
- 修改采样率前必须解除全部绑定，修改后应新建导播会话。
- 接收服务固定默认 `127.0.0.1:8790`；修改 Node 端口时须同步修改插件源码端口并重新编译。

回调不进行磁盘、网络或 TS 元数据查询。仍使用共享绑定快照和字符串返回；这不是经过硬实时认证的无分配音频实现。必须在实际 10 人并发环境验证丢包计数和声音连续性。
