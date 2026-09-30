#pragma once

#include "protocol.hpp"

#include <array>
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <mutex>
#include <string>
#include <thread>

namespace voicebridge {

struct TransportStats {
  std::uint64_t enqueued = 0;
  std::uint64_t sent = 0;
  std::uint64_t dropped = 0;
  std::uint64_t sendErrors = 0;
};

class BridgeTransport {
 public:
  BridgeTransport();
  ~BridgeTransport();

  bool start(const std::string& host, std::uint16_t port);
  void stop();

  bool enqueueAudio(
      std::string_view channelId,
      std::uint64_t connectionHandlerId,
      std::uint16_t clientId,
      const std::int16_t* samples,
      std::uint32_t sampleCount,
      std::uint16_t channels,
      std::uint32_t sampleRate,
      std::uint64_t ptsSamples);
  void enqueueJson(std::string json);
  TransportStats stats() const;

 private:
  static constexpr std::size_t kRingSize = 2048;

  void run();
  bool popAudio(AudioFrame& frame);
  bool popJson(std::string& json);
  bool sendBytes(const std::uint8_t* data, std::size_t size);

  struct Clock { std::uint64_t handler=0; std::uint16_t client=0; std::uint32_t rate=0; std::uint64_t next=0; };
  std::array<Clock, 128> clocks_{};
  std::uint32_t sourceNonce_=0;
  std::array<AudioFrame, kRingSize> ring_{};
  std::size_t head_ = 0;
  std::size_t tail_ = 0;
  std::atomic_flag ringLock_ = ATOMIC_FLAG_INIT;
  std::atomic<std::uint64_t> sequence_{0};
  std::atomic<std::uint64_t> enqueued_{0};
  std::atomic<std::uint64_t> sent_{0};
  std::atomic<std::uint64_t> dropped_{0};
  std::atomic<std::uint64_t> sendErrors_{0};

  std::mutex controlMutex_;
  std::deque<std::string> controlQueue_;
  std::mutex wakeMutex_;
  std::condition_variable wake_;
  std::atomic<bool> running_{false};
  std::thread worker_;
  std::intptr_t socket_ = -1;
  alignas(std::max_align_t) std::array<std::uint8_t, 32> destination_{};
  std::size_t destinationSize_ = 0;
};

}  // namespace voicebridge
