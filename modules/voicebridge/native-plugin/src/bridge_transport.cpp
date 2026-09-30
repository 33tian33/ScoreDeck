#include "bridge_transport.hpp"

#include <chrono>
#include <cstring>
#include <utility>
#include <vector>
#include <random>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

namespace voicebridge {
namespace {

#ifdef _WIN32
using NativeSocket = SOCKET;
constexpr NativeSocket kInvalidSocket = INVALID_SOCKET;
void closeSocket(NativeSocket socket) { closesocket(socket); }
#else
using NativeSocket = int;
constexpr NativeSocket kInvalidSocket = -1;
void closeSocket(NativeSocket socket) { close(socket); }
#endif

NativeSocket nativeSocket(std::intptr_t value) {
  return static_cast<NativeSocket>(value);
}

}  // namespace

BridgeTransport::BridgeTransport() = default;

BridgeTransport::~BridgeTransport() {
  stop();
}

bool BridgeTransport::start(const std::string& host, std::uint16_t port) {
  if (running_.load()) return true;
  if (host != "127.0.0.1") return false;

#ifdef _WIN32
  WSADATA data{};
  if (WSAStartup(MAKEWORD(2, 2), &data) != 0) return false;
#endif

  const auto socket = ::socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  if (socket == kInvalidSocket) {
#ifdef _WIN32
    WSACleanup();
#endif
    return false;
  }

  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_port = htons(port);
  if (inet_pton(AF_INET, host.c_str(), &address.sin_addr) != 1) {
    closeSocket(socket);
#ifdef _WIN32
    WSACleanup();
#endif
    return false;
  }

  static_assert(sizeof(address) <= 32, "destination storage is too small");
  std::memcpy(destination_.data(), &address, sizeof(address));
  destinationSize_ = sizeof(address);
  socket_ = static_cast<std::intptr_t>(socket);
  sourceNonce_ = std::random_device{}();
  if (!sourceNonce_) sourceNonce_ = 1;
  clocks_ = {};
  running_.store(true);
  worker_ = std::thread(&BridgeTransport::run, this);
  return true;
}

void BridgeTransport::stop() {
  if (!running_.exchange(false)) return;
  wake_.notify_all();
  if (worker_.joinable()) worker_.join();
  if (nativeSocket(socket_) != kInvalidSocket) closeSocket(nativeSocket(socket_));
  socket_ = -1;
#ifdef _WIN32
  WSACleanup();
#endif
}

bool BridgeTransport::enqueueAudio(
    std::string_view channelId,
    std::uint64_t connectionHandlerId,
    std::uint16_t clientId,
    const std::int16_t* samples,
    std::uint32_t sampleCount,
    std::uint16_t channels,
    std::uint32_t sampleRate,
    std::uint64_t ptsSamples) {
  const auto values = static_cast<std::size_t>(sampleCount) * channels;
  if (!running_.load() || !samples || values == 0 || values > kMaxPcmValues) {
    dropped_.fetch_add(1);
    return false;
  }
  if (ringLock_.test_and_set(std::memory_order_acquire)) {
    dropped_.fetch_add(1);
    return false;
  }

  // Continue in sample units during an active speech burst; re-anchor after a pause.
  Clock* clock = nullptr;
  for (auto& candidate : clocks_) {
    if (candidate.handler == connectionHandlerId && candidate.client == clientId) { clock=&candidate; break; }
  }
  if (!clock) for (auto& candidate : clocks_) if (!candidate.handler) { clock=&candidate; break; }
  if (clock) {
    const auto delta = ptsSamples > clock->next ? ptsSamples-clock->next : clock->next-ptsSamples;
    if (clock->rate == sampleRate && delta < sampleRate / 25) ptsSamples=clock->next;
    *clock = {connectionHandlerId, clientId, sampleRate, ptsSamples+sampleCount};
  }
  const auto next = (head_ + 1) % kRingSize;
  if (next == tail_) {
    ringLock_.clear(std::memory_order_release);
    dropped_.fetch_add(1);
    return false;
  }

  auto& frame = ring_[head_];
  frame.sequence = sequence_.fetch_add(1) + 1;
  frame.connectionHandlerId = connectionHandlerId;
  frame.clientId = clientId;
  frame.channels = channels;
  frame.sampleRate = sampleRate;
  frame.sampleCount = sampleCount;
  frame.ptsSamples = ptsSamples;
  frame.flags = sourceNonce_;
  setChannelId(frame, channelId);
  std::memcpy(frame.pcm.data(), samples, values * sizeof(std::int16_t));
  head_ = next;
  ringLock_.clear(std::memory_order_release);
  enqueued_.fetch_add(1);
  wake_.notify_one();
  return true;
}

void BridgeTransport::enqueueJson(std::string json) {
  if (!running_.load()) return;
  {
    std::lock_guard<std::mutex> lock(controlMutex_);
    if (controlQueue_.size() >= 256) {
      controlQueue_.pop_front();
      dropped_.fetch_add(1);
    }
    controlQueue_.push_back(std::move(json));
  }
  wake_.notify_one();
}

bool BridgeTransport::popAudio(AudioFrame& frame) {
  while (ringLock_.test_and_set(std::memory_order_acquire)) {
    std::this_thread::yield();
  }
  if (tail_ == head_) {
    ringLock_.clear(std::memory_order_release);
    return false;
  }
  frame = ring_[tail_];
  tail_ = (tail_ + 1) % kRingSize;
  ringLock_.clear(std::memory_order_release);
  return true;
}

bool BridgeTransport::popJson(std::string& json) {
  std::lock_guard<std::mutex> lock(controlMutex_);
  if (controlQueue_.empty()) return false;
  json = std::move(controlQueue_.front());
  controlQueue_.pop_front();
  return true;
}

bool BridgeTransport::sendBytes(const std::uint8_t* data, std::size_t size) {
#ifdef _WIN32
  const auto destinationLength = static_cast<int>(destinationSize_);
#else
  const auto destinationLength = static_cast<socklen_t>(destinationSize_);
#endif
  const auto result = sendto(
      nativeSocket(socket_),
      reinterpret_cast<const char*>(data),
      static_cast<int>(size),
      0,
      reinterpret_cast<const sockaddr*>(destination_.data()),
      destinationLength);
  if (result < 0 || static_cast<std::size_t>(result) != size) {
    sendErrors_.fetch_add(1);
    return false;
  }
  sent_.fetch_add(1);
  return true;
}

void BridgeTransport::run() {
  std::array<std::uint8_t, kAudioHeaderBytes + kMaxPcmValues * 2> packet{};
  AudioFrame frame;
  std::string json;
  while (running_.load()) {
    bool didWork = false;
    while (popJson(json)) {
      std::vector<std::uint8_t> control(4 + json.size());
      std::memcpy(control.data(), "TSVJ", 4);
      std::memcpy(control.data() + 4, json.data(), json.size());
      sendBytes(control.data(), control.size());
      didWork = true;
    }
    while (popAudio(frame)) {
      const auto bytes = encodeAudioPacket(frame, packet.data(), packet.size());
      if (bytes) sendBytes(packet.data(), bytes);
      didWork = true;
    }
    if (!didWork) {
      std::unique_lock<std::mutex> lock(wakeMutex_);
      wake_.wait_for(lock, std::chrono::milliseconds(20));
    }
  }
}

TransportStats BridgeTransport::stats() const {
  return {
      enqueued_.load(),
      sent_.load(),
      dropped_.load(),
      sendErrors_.load()};
}

}  // namespace voicebridge
