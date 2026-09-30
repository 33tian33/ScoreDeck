#pragma once

#include <cstddef>
#include <teamspeak/public_definitions.h>

struct TS3Functions {
  void (*printMessageToCurrentTab)(const char*);
  unsigned int (*getClientVariableAsString)(
      uint64,
      anyID,
      std::size_t,
      char**);
  void (*freeMemory)(void*);
  unsigned int (*getClientList)(uint64, anyID**);
};
