#pragma once

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string_view>

namespace voicebridge {

constexpr std::size_t kAudioHeaderBytes = 88;
constexpr std::size_t kChannelIdBytes = 32;
constexpr std::size_t kMaxPcmValues = 4096;
constexpr std::uint16_t kProtocolVersion = 1;
constexpr std::uint16_t kAudioPacketType = 1;

inline void writeU16(std::uint8_t* output, std::uint16_t value) {
  output[0] = static_cast<std::uint8_t>(value);
  output[1] = static_cast<std::uint8_t>(value >> 8U);
}

inline void writeU32(std::uint8_t* output, std::uint32_t value) {
  for (unsigned int i = 0; i < 4; ++i) {
    output[i] = static_cast<std::uint8_t>(value >> (i * 8U));
  }
}

inline void writeU64(std::uint8_t* output, std::uint64_t value) {
  for (unsigned int i = 0; i < 8; ++i) {
    output[i] = static_cast<std::uint8_t>(value >> (i * 8U));
  }
}

struct AudioFrame {
  std::uint64_t sequence = 0;
  std::uint64_t connectionHandlerId = 0;
  std::uint16_t clientId = 0;
  std::uint16_t channels = 0;
  std::uint32_t sampleRate = 0;
  std::uint32_t sampleCount = 0;
  std::uint64_t ptsSamples = 0;
  std::uint32_t flags = 0;
  std::array<char, kChannelIdBytes> channelId{};
  std::array<std::int16_t, kMaxPcmValues> pcm{};
};

inline std::size_t encodeAudioPacket(
    const AudioFrame& frame,
    std::uint8_t* output,
    std::size_t capacity) {
  const auto valueCount =
      static_cast<std::size_t>(frame.sampleCount) * frame.channels;
  const auto payloadBytes = valueCount * sizeof(std::int16_t);
  const auto packetBytes = kAudioHeaderBytes + payloadBytes;
  if (valueCount > kMaxPcmValues || capacity < packetBytes) return 0;

  std::fill(output, output + kAudioHeaderBytes, 0);
  std::memcpy(output, "TSVB", 4);
  writeU16(output + 4, kProtocolVersion);
  writeU16(output + 6, kAudioPacketType);
  writeU16(output + 8, static_cast<std::uint16_t>(kAudioHeaderBytes));
  writeU64(output + 12, frame.sequence);
  writeU64(output + 20, frame.connectionHandlerId);
  writeU16(output + 28, frame.clientId);
  writeU16(output + 30, frame.channels);
  writeU32(output + 32, frame.sampleRate);
  writeU32(output + 36, frame.sampleCount);
  writeU64(output + 40, frame.ptsSamples);
  writeU32(output + 48, static_cast<std::uint32_t>(payloadBytes));
  writeU32(output + 52, frame.flags);
  std::memcpy(output + 56, frame.channelId.data(), kChannelIdBytes);
  std::memcpy(output + kAudioHeaderBytes, frame.pcm.data(), payloadBytes);
  return packetBytes;
}

inline void setChannelId(AudioFrame& frame, std::string_view channelId) {
  frame.channelId.fill('\0');
  const auto count = std::min(channelId.size(), frame.channelId.size() - 1);
  std::memcpy(frame.channelId.data(), channelId.data(), count);
}

}  // namespace voicebridge
