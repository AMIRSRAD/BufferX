# BufferXCore -- the banking domain library.
#
# This target must stay free of UI, transport, and platform dependencies so the
# same sources compile for the native host and for wasm32-emscripten. Its only
# dependency is a crypto provider.

add_library(BufferXCore STATIC
    src/BankingTools.cpp
    src/Crypto.cpp
    src/Hex.cpp
    src/IranSystem.cpp
    src/Iso8583.cpp
    src/Mac.cpp
    src/Packager.cpp
    src/PackagerLoader.cpp
    src/PinBlock.cpp
    src/PinTranslation.cpp
    src/PinVerification.cpp
    src/RsaSha.cpp
    src/TextCodec.cpp
    src/Tlv.cpp
    src/XmlLite.cpp
)
add_library(BufferX::Core ALIAS BufferXCore)

target_include_directories(BufferXCore
    PUBLIC  ${CMAKE_CURRENT_SOURCE_DIR}/include
    PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_compile_features(BufferXCore PUBLIC cxx_std_17)
set_target_properties(BufferXCore PROPERTIES POSITION_INDEPENDENT_CODE ON)

target_link_libraries(BufferXCore PUBLIC OpenSSL::Crypto)

# OpenSSL 3 deprecated the low-level DES_* API, but single DES and the raw
# key-schedule calls are unavoidable here: ISO PIN block translation and legacy
# ATM host MACs are specified in terms of them. The deprecation is acknowledged
# rather than worked around, because the EVP replacements do not expose the
# single-block primitives these algorithms need.
target_compile_definitions(BufferXCore PRIVATE OPENSSL_SUPPRESS_DEPRECATED)

if(MSVC)
    target_compile_options(BufferXCore PRIVATE /W4 /utf-8)
else()
    target_compile_options(BufferXCore PRIVATE -Wall -Wextra)
endif()

# --- Verification executables ------------------------------------------------

if(BUFFERX_BUILD_TESTS)
    # Proves the de-Qt'd IranSystem converter still produces the byte sequences
    # the Qt test suite asserted.
    add_executable(BufferXIranSystemPortTest tests/IranSystemPortTest.cpp)
    target_link_libraries(BufferXIranSystemPortTest PRIVATE BufferXCore)
    add_test(NAME IranSystemPort COMMAND BufferXIranSystemPortTest)

    # Proves the hand-rolled XML reader loads the real packager definitions and
    # rejects malformed input.
    add_executable(BufferXPackagerLoaderTest tests/PackagerLoaderTest.cpp)
    target_link_libraries(BufferXPackagerLoaderTest PRIVATE BufferXCore)
    target_compile_definitions(BufferXPackagerLoaderTest
        PRIVATE BUFFERX_SOURCE_DIR="${CMAKE_SOURCE_DIR}")
    add_test(NAME PackagerLoader COMMAND BufferXPackagerLoaderTest)

    # Proves the portable Windows-1256 table matches the Win32 API it replaced.
    # Windows-only by nature: it calls the API it is being compared against.
    if(WIN32)
        add_executable(BufferXCp1256DifferentialTest tests/Cp1256DifferentialTest.cpp)
        target_link_libraries(BufferXCp1256DifferentialTest PRIVATE BufferXCore)
        target_include_directories(BufferXCp1256DifferentialTest PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
        add_test(NAME Cp1256Differential COMMAND BufferXCp1256DifferentialTest)
    endif()
endif()
