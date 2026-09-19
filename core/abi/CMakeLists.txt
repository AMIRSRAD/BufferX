# The BufferX C ABI -- the single JSON-in / JSON-out surface over BufferXCore.
#
# Two targets are produced from the same sources:
#
#   BufferXAbi          static, for anything that links C++ directly (the tests,
#                       and the Emscripten build, which wants one archive)
#   bufferx_abi_shared   shared, named `bufferx_abi`, for the Rust host to load
#                       or link against over FFI
#
# The parent CMakeLists has already run project() and find_package(OpenSSL);
# neither is repeated here.

# --- Built-in packager definitions -------------------------------------------

# data/packagers.xml is compiled into the engine so an opened session already
# has definitions. CONFIGURE_DEPENDS is not available for configure_file, so the
# XML is listed via a dependency below to make edits trigger a rebuild.
set(BUFFERX_PACKAGERS_FILE ${CMAKE_SOURCE_DIR}/data/packagers.xml)

# Read as hex and emit a byte array. A string literal would be simpler but MSVC
# caps one at 65,535 bytes and these definitions exceed that.
file(READ ${BUFFERX_PACKAGERS_FILE} BUFFERX_PACKAGERS_HEX HEX)
string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1," BUFFERX_PACKAGERS_BYTES "${BUFFERX_PACKAGERS_HEX}")
# Wrap so the generated file is not one enormous line, which some tools choke on.
string(REGEX REPLACE "(([^,]+,){16})" "\\1\n" BUFFERX_DEFAULT_PACKAGERS_BYTES "${BUFFERX_PACKAGERS_BYTES}")

configure_file(
    ${CMAKE_CURRENT_SOURCE_DIR}/DefaultPackagers.cpp.in
    ${CMAKE_CURRENT_BINARY_DIR}/generated/DefaultPackagers.cpp
    @ONLY
)
set(BUFFERX_GENERATED_SOURCES ${CMAKE_CURRENT_BINARY_DIR}/generated/DefaultPackagers.cpp)
# Re-run CMake when the definitions change, so the embedded copy cannot go stale.
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${BUFFERX_PACKAGERS_FILE})

# --- Static library ----------------------------------------------------------

add_library(BufferXAbi STATIC
    JsonLite.cpp
    bufferx_abi.cpp
    ${BUFFERX_GENERATED_SOURCES}
)
add_library(BufferX::Abi ALIAS BufferXAbi)

# PUBLIC: consumers include "bufferx_abi.h" and, for the WASM glue, "JsonLite.h".
target_include_directories(BufferXAbi
    PUBLIC  ${CMAKE_CURRENT_SOURCE_DIR}
    PRIVATE ${CMAKE_CURRENT_BINARY_DIR}/generated
)

target_compile_features(BufferXAbi PUBLIC cxx_std_17)
set_target_properties(BufferXAbi PROPERTIES POSITION_INDEPENDENT_CODE ON)

target_link_libraries(BufferXAbi PUBLIC BufferXCore)

if(MSVC)
    target_compile_options(BufferXAbi PRIVATE /W4 /utf-8)
else()
    target_compile_options(BufferXAbi PRIVATE -Wall -Wextra)
endif()

# --- Shared library for the Rust FFI ----------------------------------------

# Built from the same translation units rather than by wrapping the static
# archive: whole-archive linking of a static library differs across the three
# toolchains this has to work on, and the sources are cheap to compile twice.
add_library(bufferx_abi_shared SHARED
    JsonLite.cpp
    bufferx_abi.cpp
    ${BUFFERX_GENERATED_SOURCES}
)

set_target_properties(bufferx_abi_shared PROPERTIES
    OUTPUT_NAME               bufferx_abi
    POSITION_INDEPENDENT_CODE ON
    # Everything is hidden by default; the five entry points opt back in via
    # BUFFERX_ABI_API in the header. Exporting the whole C++ core instead
    # (WINDOWS_EXPORT_ALL_SYMBOLS, default ELF visibility) would put this
    # library's std::string instantiations in the host's symbol namespace,
    # where they can bind to the host's and silently disagree about layout.
    CXX_VISIBILITY_PRESET     hidden
    VISIBILITY_INLINES_HIDDEN ON
)

target_compile_definitions(bufferx_abi_shared PRIVATE BUFFERX_ABI_BUILD_SHARED)

target_include_directories(bufferx_abi_shared
    PUBLIC  ${CMAKE_CURRENT_SOURCE_DIR}
    PRIVATE ${CMAKE_CURRENT_BINARY_DIR}/generated
)
target_compile_features(bufferx_abi_shared PUBLIC cxx_std_17)
target_link_libraries(bufferx_abi_shared PRIVATE BufferXCore)

if(MSVC)
    target_compile_options(bufferx_abi_shared PRIVATE /W4 /utf-8)
else()
    target_compile_options(bufferx_abi_shared PRIVATE -Wall -Wextra)
endif()

# --- WebAssembly module ------------------------------------------------------

# Produces bufferx_core.js + bufferx_core.wasm, which the frontend loads when it
# is not running inside Tauri. The browser and the desktop then run byte-identical
# banking logic rather than two implementations that can drift.
#
# Driven by scripts/build-wasm.sh; see that script for the OpenSSL-for-wasm
# prerequisite.
if(EMSCRIPTEN)
    add_executable(bufferx_wasm bufferx_wasm.cpp)
    target_link_libraries(bufferx_wasm PRIVATE BufferXAbi)
    target_compile_features(bufferx_wasm PRIVATE cxx_std_17)

    set_target_properties(bufferx_wasm PROPERTIES OUTPUT_NAME bufferx_core)

    # MODULARIZE + EXPORT_ES6 give a default-exported factory, which is what
    # app/src/engine/transport.ts imports. ALLOW_MEMORY_GROWTH matters because a
    # pasted buffer can be far larger than any fixed heap we would pick.
    target_link_options(bufferx_wasm PRIVATE
        "-sMODULARIZE=1"
        "-sEXPORT_ES6=1"
        "-sENVIRONMENT=web,worker"
        "-sALLOW_MEMORY_GROWTH=1"
        "-sEXPORTED_FUNCTIONS=['_bufferx_open','_bufferx_close','_bufferx_invoke','_bufferx_string_free','_bufferx_version','_malloc','_free']"
        "-sEXPORTED_RUNTIME_METHODS=['cwrap','ccall','UTF8ToString','stringToUTF8']"
        "-sFILESYSTEM=0"
        "-sEXIT_RUNTIME=0"
        "--closure=0"
        "-O3"
    )
endif()

# --- Verification executables ------------------------------------------------

if(BUFFERX_BUILD_TESTS)
    # Proves the JSON reader/writer round-trips every type and refuses hostile
    # input. It links the source directly rather than BufferXAbi so a JSON
    # failure cannot be masked by a link error elsewhere.
    add_executable(BufferXJsonLiteTest tests/JsonLiteTest.cpp JsonLite.cpp)
    target_include_directories(BufferXJsonLiteTest PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_compile_features(BufferXJsonLiteTest PRIVATE cxx_std_17)
    add_test(NAME JsonLite COMMAND BufferXJsonLiteTest)

    # Drives the ABI exactly as a host does: through bufferx_invoke, on JSON
    # text, checking the envelopes that come back.
    add_executable(BufferXAbiTest tests/AbiTest.cpp)
    target_link_libraries(BufferXAbiTest PRIVATE BufferXAbi)
    target_compile_features(BufferXAbiTest PRIVATE cxx_std_17)
    add_test(NAME Abi COMMAND BufferXAbiTest)

    # Drives the ABI against the real shipped packager definitions rather than
    # inline fixtures, so a regression against production data is caught here.
    add_executable(BufferXRealPackagerE2ETest tests/RealPackagerE2ETest.cpp)
    target_link_libraries(BufferXRealPackagerE2ETest PRIVATE BufferXAbi)
    target_compile_features(BufferXRealPackagerE2ETest PRIVATE cxx_std_17)
    target_compile_definitions(BufferXRealPackagerE2ETest
        PRIVATE BUFFERX_SOURCE_DIR="${CMAKE_SOURCE_DIR}")
    add_test(NAME RealPackagerE2E COMMAND BufferXRealPackagerE2ETest)
endif()
