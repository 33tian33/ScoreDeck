cmake_minimum_required(VERSION 3.20)
project(teamspeak_voicebridge VERSION 0.5.0 LANGUAGES CXX)

option(VOICEBRIDGE_BUILD_PLUGIN "Build the TeamSpeak plugin" ON)
option(VOICEBRIDGE_BUILD_TESTS "Build protocol tests" ON)
option(VOICEBRIDGE_USE_MOCK_SDK "Compile against the test-only API surface mock" OFF)

if(WIN32 AND NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "VoiceBridge 0.4 requires a 64-bit build for TS3 x64. Configure with -A x64.")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(VOICEBRIDGE_BUILD_PLUGIN)
  set(TS3_PLUGIN_SDK_ROOT "" CACHE PATH "Root of the official TeamSpeak 3 Client Plugin SDK")
  if(VOICEBRIDGE_USE_MOCK_SDK)
    set(TS3_PLUGIN_SDK_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/tests/mock-sdk")
  endif()
  if(NOT EXISTS "${TS3_PLUGIN_SDK_ROOT}/include/ts3_functions.h")
    message(FATAL_ERROR
      "Set TS3_PLUGIN_SDK_ROOT to the official ts3client-pluginsdk checkout. "
      "Expected include/ts3_functions.h below that directory.")
  endif()

  add_library(voicebridge SHARED
    src/plugin.cpp
    src/bridge_transport.cpp
  )
  target_include_directories(voicebridge PRIVATE
    "${TS3_PLUGIN_SDK_ROOT}/include"
    "${CMAKE_CURRENT_SOURCE_DIR}/src"
  )
  target_compile_definitions(voicebridge PRIVATE VOICEBRIDGE_VERSION="${PROJECT_VERSION}")
  if(MSVC)
    # The source contains Chinese status messages; force UTF-8 instead of the
    # active Windows code page (for example CP936).
    target_compile_options(voicebridge PRIVATE /utf-8)
  endif()
  set_target_properties(voicebridge PROPERTIES
    PREFIX ""
    OUTPUT_NAME "voicebridge"
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN YES
  )
  if(NOT WIN32)
    find_package(Threads REQUIRED)
    target_link_libraries(voicebridge PRIVATE Threads::Threads)
  endif()
  if(WIN32)
    target_link_libraries(voicebridge PRIVATE ws2_32)
  endif()
endif()

if(VOICEBRIDGE_BUILD_TESTS)
  enable_testing()
  add_executable(protocol_test tests/protocol_test.cpp)
  target_include_directories(protocol_test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
  add_test(NAME protocol_test COMMAND protocol_test)
endif()
