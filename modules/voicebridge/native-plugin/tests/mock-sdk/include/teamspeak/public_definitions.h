#pragma once

#include <cstdint>

using uint64 = std::uint64_t;
using anyID = std::uint16_t;

enum ClientProperties {
  CLIENT_UNIQUE_IDENTIFIER = 0,
  CLIENT_NICKNAME = 1
};
