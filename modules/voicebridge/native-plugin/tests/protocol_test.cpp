#include "protocol.hpp"

#include <cassert>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <vector>

std::uint64_t readU64(const std::uint8_t* input) {
  std::uint64_t value = 0;
  for (unsigned int i = 0; i < 8; ++i) {
    value |= static_cast<std::uint64_t>(input[i]) << (i * 8U);
  }
  return value;
}

int main() {
  voicebridge::AudioFrame frame;
  frame.sequence = 19;
  frame.connectionHandlerId = 17;
  frame.clientId = 42;
  frame.channels = 1;
  frame.sampleRate = 48000;
  frame.sampleCount = 4;
  frame.ptsSamples = 9600;
  voicebridge::setChannelId(frame, "channel-alpha");
  frame.pcm[0] = 1;
  frame.pcm[1] = 2;
  frame.pcm[2] = 3;
  frame.pcm[3] = 4;

  std::vector<std::uint8_t> packet(voicebridge::kAudioHeaderBytes + 8);
  const auto bytes =
      voicebridge::encodeAudioPacket(frame, packet.data(), packet.size());
  assert(bytes == packet.size());
  assert(std::memcmp(packet.data(), "TSVB", 4) == 0);
  assert(readU64(packet.data() + 12) == 19);
  assert(readU64(packet.data() + 20) == 17);
  assert(readU64(packet.data() + 40) == 9600);
  assert(std::strcmp(
             reinterpret_cast<const char*>(packet.data() + 56),
             "channel-alpha") == 0);
  assert(packet[voicebridge::kAudioHeaderBytes] == 1);
  assert(packet[voicebridge::kAudioHeaderBytes + 2] == 2);
  std::cout << "protocol_test passed\n";
  return 0;
}
