#include "bridge_transport.hpp"

#include <plugin_definitions.h>
#include <teamspeak/public_definitions.h>
#include <teamspeak/public_errors.h>
#include <ts3_functions.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <filesystem>
#include <fstream>
#ifdef _WIN32
#include <windows.h>
#endif

#ifdef _WIN32
#define PLUGIN_EXPORT extern "C" __declspec(dllexport)
#else
#define PLUGIN_EXPORT extern "C" __attribute__((visibility("default")))
#endif

#ifndef VOICEBRIDGE_VERSION
#define VOICEBRIDGE_VERSION "0.5.0"
#endif

// Some API 26 SDK distributions omit this macro from plugin_definitions.h.
// Keep the plugin explicitly pinned to the API version it implements.
#ifndef PLUGIN_API_VERSION
#define PLUGIN_API_VERSION 26
#endif

namespace {

using Bindings = std::unordered_map<std::uint64_t, std::string>;

TS3Functions g_ts3{};
std::mutex g_bindingMutex;
voicebridge::BridgeTransport g_transport;
std::shared_ptr<const Bindings> g_bindings = std::make_shared<const Bindings>();
std::atomic<std::uint32_t> g_sampleRate{48000};
std::chrono::steady_clock::time_point g_origin;
char* g_pluginId = nullptr;
std::atomic<bool> g_heartbeatRunning{false};
std::thread g_heartbeat;
std::mutex g_heartbeatMutex;
std::condition_variable g_heartbeatWake;

void print(const std::string& message) {
  if (g_ts3.printMessageToCurrentTab) g_ts3.printMessageToCurrentTab(message.c_str());
}

std::string jsonEscape(const std::string& value) {
  std::ostringstream output;
  for (const auto ch : value) {
    switch (ch) {
      case '\\': output << "\\\\"; break;
      case '"': output << "\\\""; break;
      case '\n': output << "\\n"; break;
      case '\r': output << "\\r"; break;
      case '\t': output << "\\t"; break;
      default:
        if (static_cast<unsigned char>(ch) < 0x20) {
          output << '?';
        } else {
          output << ch;
        }
    }
  }
  return output.str();
}

bool validChannelId(const std::string& value) {
  if (value.empty() || value.size() >= voicebridge::kChannelIdBytes) return false;
  return std::all_of(value.begin(), value.end(), [](unsigned char ch) {
    return std::isalnum(ch) || ch == '-' || ch == '_';
  });
}

std::shared_ptr<const Bindings> bindingSnapshot() {
  return std::atomic_load(&g_bindings);
}

void setBinding(std::uint64_t handlerId, const std::string& channelId) {
  std::lock_guard<std::mutex> lock(g_bindingMutex);
  const auto current = bindingSnapshot();
  auto next = std::make_shared<Bindings>(*current);
  if (channelId.empty()) {
    next->erase(handlerId);
  } else {
    (*next)[handlerId] = channelId;
  }
  std::atomic_store(&g_bindings, std::const_pointer_cast<const Bindings>(next));
}

std::string boundChannel(std::uint64_t handlerId) {
  const auto snapshot = bindingSnapshot();
  const auto found = snapshot->find(handlerId);
  return found == snapshot->end() ? std::string() : found->second;
}

std::string readClientString(
    std::uint64_t handlerId,
    anyID clientId,
    ClientProperties property) {
  char* raw = nullptr;
  const auto error =
      g_ts3.getClientVariableAsString(handlerId, clientId, property, &raw);
  if (error != ERROR_ok || !raw) return {};
  std::string value(raw);
  g_ts3.freeMemory(raw);
  return value;
}

void publishSpeaker(
    std::uint64_t handlerId,
    anyID clientId,
    const std::string& channelId) {
  if (channelId.empty()) return;
  if(g_ts3.getClientID && g_ts3.getChannelOfClient){
    anyID me=0;uint64 mine=0,theirs=0;
    if(g_ts3.getClientID(handlerId,&me)!=ERROR_ok||me==clientId||g_ts3.getChannelOfClient(handlerId,me,&mine)!=ERROR_ok||g_ts3.getChannelOfClient(handlerId,clientId,&theirs)!=ERROR_ok||mine!=theirs)return;
  }
  auto stableId =
      readClientString(handlerId, clientId, CLIENT_UNIQUE_IDENTIFIER);
  auto name = readClientString(handlerId, clientId, CLIENT_NICKNAME);
  if (stableId.empty()) stableId = std::to_string(handlerId) + ":" + std::to_string(clientId);
  if (name.empty()) name = "TS " + std::to_string(clientId);
  std::ostringstream json;
  json << "{\"type\":\"speaker\",\"connectionHandlerId\":\""
       << handlerId << "\",\"clientId\":\"" << clientId
       << "\",\"channelId\":\"" << jsonEscape(channelId)
       << "\",\"stableId\":\"" << jsonEscape(stableId)
       << "\",\"name\":\"" << jsonEscape(name) << "\"}";
  g_transport.enqueueJson(json.str());
}

void publishBinding(
    std::uint64_t handlerId,
    const std::string& channelId,
    bool active) {
  std::ostringstream json;
  json << "{\"type\":\"binding\",\"connectionHandlerId\":\""
       << handlerId << "\",\"channelId\":\"" << jsonEscape(channelId)
       << "\",\"active\":" << (active ? "true" : "false") << "}";
  g_transport.enqueueJson(json.str());
}

void publishKnownClients(std::uint64_t handlerId, const std::string& channelId) {
  anyID* clients = nullptr;
  if (g_ts3.getClientList(handlerId, &clients) != ERROR_ok || !clients) return;
  for (auto* client = clients; *client != 0; ++client) {
    publishSpeaker(handlerId, *client, channelId);
  }
  g_ts3.freeMemory(clients);
}

std::vector<std::string> words(const char* command) {
  std::istringstream input(command ? command : "");
  std::vector<std::string> result;
  std::string word;
  while (input >> word) result.push_back(word);
  return result;
}

std::uint64_t ptsSamples() {
  const auto elapsed = std::chrono::steady_clock::now() - g_origin;
  const auto micros =
      std::chrono::duration_cast<std::chrono::microseconds>(elapsed).count();
  return static_cast<std::uint64_t>(
      (micros * static_cast<std::int64_t>(g_sampleRate.load())) / 1'000'000LL);
}

#ifdef _WIN32
std::filesystem::path controlDir(){
 wchar_t buf[32768];DWORD size=GetEnvironmentVariableW(L"APPDATA",buf,32768);
 if(!size||size>=32768)return {};
 return std::filesystem::path(buf)/L"VoiceBridge";
}
void writeControl(const char* name,const std::string& data){
 const auto dir=controlDir();if(dir.empty())return;
 std::filesystem::create_directories(dir);
 const auto target=dir/name,temp=dir/(std::string(name)+".tmp");
 {std::ofstream f(temp,std::ios::binary);f<<data;}
 MoveFileExW(temp.c_str(),target.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH);
}
struct PendingMove{std::string id,group;uint64 handler=0,channel=0;int ticks=0;};
PendingMove pendingMove;
void replyControl(const std::string& id,const std::string& error){
 writeControl("result.json","{\"id\":\""+jsonEscape(id)+"\",\"error\":\""+jsonEscape(error)+"\"}");
}
void guiControl(){
 const auto dir=controlDir();if(dir.empty())return;
 if(pendingMove.handler){
 anyID me=0;uint64 channel=0;
 if(g_ts3.getClientID(pendingMove.handler,&me)==ERROR_ok&&g_ts3.getChannelOfClient(pendingMove.handler,me,&channel)==ERROR_ok&&channel==pendingMove.channel){
 const auto old=boundChannel(pendingMove.handler);if(!old.empty())publishBinding(pendingMove.handler,old,false);
 setBinding(pendingMove.handler,pendingMove.group);publishBinding(pendingMove.handler,pendingMove.group,true);publishKnownClients(pendingMove.handler,pendingMove.group);
 replyControl(pendingMove.id,"");pendingMove={};
 }else if(++pendingMove.ticks>6){replyControl(pendingMove.id,"Channel move failed or timed out; check permissions/password");pendingMove={};}
 }
 if(!pendingMove.handler){
 std::ifstream f(dir/"command.txt",std::ios::binary);
 if(f){std::string id,operation,handlerText,channelText,group,password;std::getline(f,id);std::getline(f,operation);std::getline(f,handlerText);std::getline(f,channelText);std::getline(f,group);std::getline(f,password);f.close();std::filesystem::remove(dir/"command.txt");
 try{
 const auto h=std::stoull(handlerText),ch=std::stoull(channelText);
 if(operation=="unbind"){const auto old=boundChannel(h);setBinding(h,"");if(!old.empty())publishBinding(h,old,false);replyControl(id,"");}
 else if(operation=="bind"&&(group=="channel-alpha"||group=="channel-bravo")){
 bool duplicate=false;for(const auto& b:*bindingSnapshot())if(b.first!=h&&b.second==group)duplicate=true;
 if(duplicate)replyControl(id,"This team is already bound; unbind it first");
 else {anyID me=0;if(g_ts3.getClientID(h,&me)!=ERROR_ok)replyControl(id,"Connection not ready");else{
 uint64 current=0;g_ts3.getChannelOfClient(h,me,&current);
 const auto error=current==ch?ERROR_ok:g_ts3.requestClientMove(h,me,ch,password.c_str(),nullptr);
 if(error!=ERROR_ok)replyControl(id,"TeamSpeak rejected channel move: "+std::to_string(error));else {const auto old=boundChannel(h);setBinding(h,"");if(!old.empty())publishBinding(h,old,false);pendingMove={id,group,h,ch,0};}
 }}
 }else replyControl(id,"Invalid command");
 }catch(...){replyControl(id,"Invalid command fields");}
 }
 }
 uint64* handlers=nullptr;if(g_ts3.getServerConnectionHandlerList(&handlers)!=ERROR_ok||!handlers)return;
 std::ostringstream out;out<<"{\"version\":\"0.5.0\",\"connections\":[";bool first=true;
 for(auto* h=handlers;*h;h++){
 anyID me=0;if(g_ts3.getClientID(*h,&me)!=ERROR_ok)continue;uint64 current=0;g_ts3.getChannelOfClient(*h,me,&current);
 char* serverName=nullptr;g_ts3.getServerVariableAsString(*h,VIRTUALSERVER_NAME,&serverName);
 if(!first)out<<",";first=false;out<<"{\"handler\":\""<<*h<<"\",\"name\":\""<<jsonEscape(serverName?serverName:"")<<"\",\"currentChannel\":\""<<current<<"\",\"binding\":\""<<jsonEscape(boundChannel(*h))<<"\",\"channels\":[";
 if(serverName)g_ts3.freeMemory(serverName);
 uint64* channels=nullptr;bool firstChannel=true;
 if(g_ts3.getChannelList(*h,&channels)==ERROR_ok&&channels){for(auto* ch=channels;*ch;ch++){
 char* name=nullptr;if(g_ts3.getChannelVariableAsString(*h,*ch,CHANNEL_NAME,&name)!=ERROR_ok)continue;
 if(!firstChannel)out<<",";firstChannel=false;out<<"{\"id\":\""<<*ch<<"\",\"name\":\""<<jsonEscape(name?name:"")<<"\"}";if(name)g_ts3.freeMemory(name);
 }g_ts3.freeMemory(channels);}out<<"]}";
 }
 g_ts3.freeMemory(handlers);out<<"]}";writeControl("inventory.json",out.str());
}
#else
void guiControl(){}
#endif

}  // namespace

PLUGIN_EXPORT const char* ts3plugin_name() {
  return "VoiceBridge 双频道 PCM";
}

PLUGIN_EXPORT const char* ts3plugin_version() {
  return VOICEBRIDGE_VERSION;
}

PLUGIN_EXPORT int ts3plugin_apiVersion() {
  return PLUGIN_API_VERSION;
}

PLUGIN_EXPORT const char* ts3plugin_author() {
  return "TeamSpeak Director MVP";
}

PLUGIN_EXPORT const char* ts3plugin_description() {
  return "按连接和说话人采集 TeamSpeak PCM，并发送到本机导播服务。";
}

PLUGIN_EXPORT void ts3plugin_setFunctionPointers(const TS3Functions functions) {
  g_ts3 = functions;
}

PLUGIN_EXPORT int ts3plugin_init() {
  g_origin = std::chrono::steady_clock::now();
  if (!g_transport.start("127.0.0.1", 8790)) return 1;
  g_heartbeatRunning.store(true);
  g_heartbeat = std::thread([] {
    while (g_heartbeatRunning.load()) {
      try { guiControl(); } catch (...) {}
      const auto bindings = bindingSnapshot();
      for (const auto& binding : *bindings) publishBinding(binding.first, binding.second, true);
      std::unique_lock<std::mutex> lock(g_heartbeatMutex);
      g_heartbeatWake.wait_for(lock, std::chrono::seconds(2), [] { return !g_heartbeatRunning.load(); });
    }
  });
  print("[VoiceBridge] 已启动，使用 /voicebridge bind channel-alpha 绑定当前标签页。");
  return 0;
}

PLUGIN_EXPORT void ts3plugin_shutdown() {
  g_heartbeatRunning.store(false);
  g_heartbeatWake.notify_all();
  if (g_heartbeat.joinable()) g_heartbeat.join();
  g_transport.stop();
  std::free(g_pluginId);
  g_pluginId = nullptr;
}

PLUGIN_EXPORT int ts3plugin_requestAutoload() {
  return 1;
}

PLUGIN_EXPORT void ts3plugin_registerPluginID(const char* id) {
  std::free(g_pluginId);
  if (!id) {
    g_pluginId = nullptr;
    return;
  }
  const auto bytes = std::strlen(id) + 1;
  g_pluginId = static_cast<char*>(std::malloc(bytes));
  if (g_pluginId) std::memcpy(g_pluginId, id, bytes);
}

PLUGIN_EXPORT const char* ts3plugin_commandKeyword() {
  return "voicebridge";
}

PLUGIN_EXPORT int ts3plugin_processCommand(
    std::uint64_t serverConnectionHandlerID,
    const char* command) {
  const auto args = words(command);
  if (args.empty() || args[0] == "help") {
    print("[VoiceBridge] bind <channel-id> | unbind | status | rate <hz>");
    return 0;
  }

  if (args[0] == "bind") {
    if (args.size() != 2 || !validChannelId(args[1])) {
      print("[VoiceBridge] channel-id 只能含字母、数字、-、_，最长31字节。");
      return 0;
    }
    auto snapshot = bindingSnapshot();
    if (snapshot->find(serverConnectionHandlerID) == snapshot->end() &&
        snapshot->size() >= 2) {
      print("[VoiceBridge] 已绑定两个连接，请先 unbind 一个连接。");
      return 0;
    }
    for (const auto& binding : *snapshot) {
      if (binding.first != serverConnectionHandlerID && binding.second == args[1]) {
        print("[VoiceBridge] 该频道已绑定其他连接，请先解除绑定。"); return 0;
      }
    }
    const auto oldChannel = boundChannel(serverConnectionHandlerID);
    if (!oldChannel.empty() && oldChannel != args[1]) publishBinding(serverConnectionHandlerID, oldChannel, false);
    setBinding(serverConnectionHandlerID, args[1]);
    publishBinding(serverConnectionHandlerID, args[1], true);
    publishKnownClients(serverConnectionHandlerID, args[1]);
    print("[VoiceBridge] 当前连接 " + std::to_string(serverConnectionHandlerID) +
          " 已绑定为 " + args[1] + "。");
    return 0;
  }

  if (args[0] == "unbind") {
    const auto channelId = boundChannel(serverConnectionHandlerID);
    if (!channelId.empty()) publishBinding(serverConnectionHandlerID, channelId, false);
    setBinding(serverConnectionHandlerID, "");
    print("[VoiceBridge] 当前连接已解除绑定。");
    return 0;
  }

  if (args[0] == "rate") {
    if (args.size() != 2) {
      print("[VoiceBridge] 用法：/voicebridge rate 48000");
      return 0;
    }
    if (!bindingSnapshot()->empty()) {
      print("[VoiceBridge] 请先解除所有绑定后修改采样率，再新建导播会话并重新绑定。");
      return 0;
    }
    const auto rate = std::strtoul(args[1].c_str(), nullptr, 10);
    if (rate < 8000 || rate > 192000) {
      print("[VoiceBridge] 采样率必须在 8000–192000 Hz。");
      return 0;
    }
    g_sampleRate.store(static_cast<std::uint32_t>(rate));
    print("[VoiceBridge] 采样率已设为 " + std::to_string(rate) + " Hz。");
    return 0;
  }

  if (args[0] == "status") {
    const auto snapshot = bindingSnapshot();
    const auto stats = g_transport.stats();
    std::ostringstream message;
    message << "[VoiceBridge] " << snapshot->size() << "/2 个连接；采样率 "
            << g_sampleRate.load() << " Hz；已入队 " << stats.enqueued
            << "，已发送 " << stats.sent << "，丢弃 " << stats.dropped
            << "，发送错误 " << stats.sendErrors << "。";
    print(message.str());
    return 0;
  }

  print("[VoiceBridge] 未知命令。使用 /voicebridge help");
  return 0;
}

PLUGIN_EXPORT void ts3plugin_onTalkStatusChangeEvent(
    std::uint64_t serverConnectionHandlerID,
    int,
    int,
    anyID clientID) {
  publishSpeaker(
      serverConnectionHandlerID,
      clientID,
      boundChannel(serverConnectionHandlerID));
}

PLUGIN_EXPORT void ts3plugin_onUpdateClientEvent(
    std::uint64_t serverConnectionHandlerID,
    anyID clientID,
    anyID,
    const char*,
    const char*) {
  publishSpeaker(
      serverConnectionHandlerID,
      clientID,
      boundChannel(serverConnectionHandlerID));
}

PLUGIN_EXPORT void ts3plugin_onEditPostProcessVoiceDataEvent(
    std::uint64_t serverConnectionHandlerID,
    anyID clientID,
    short* samples,
    int sampleCount,
    int channels,
    const unsigned int*,
    unsigned int*) {
  if (!samples || sampleCount <= 0 || channels <= 0) return;
  const auto channelId = boundChannel(serverConnectionHandlerID);
  if (channelId.empty()) return;
  g_transport.enqueueAudio(
      channelId,
      serverConnectionHandlerID,
      clientID,
      reinterpret_cast<std::int16_t*>(samples),
      static_cast<std::uint32_t>(sampleCount),
      static_cast<std::uint16_t>(channels),
      g_sampleRate.load(),
      ptsSamples());
}

PLUGIN_EXPORT void ts3plugin_onConnectStatusChangeEvent(std::uint64_t handler, int status, unsigned int) {
  if (status == 0) {
    const auto channel = boundChannel(handler);
    if (!channel.empty()) publishBinding(handler, channel, false);
    setBinding(handler, "");
  }
}
