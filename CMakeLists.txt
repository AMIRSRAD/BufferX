cmake_minimum_required(VERSION 3.23)
project(BufferX LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
enable_testing()

find_package(Qt6 REQUIRED COMPONENTS Core Gui Qml Quick QuickControls2 Widgets)
find_package(OpenSSL REQUIRED)

set(BUFFERX_CORE_SOURCES
    src/Backend.cpp
    src/Crypto.cpp
    src/Iso8583.cpp
    src/Mac.cpp
    src/Packager.cpp
    src/PackagerLoader.cpp
    src/Hex.cpp
)

qt_add_executable(BufferX WIN32
    main.cpp
    ${BUFFERX_CORE_SOURCES}
)

qt_add_resources(BufferX "resources"
    PREFIX "/"
    FILES
        ui/Main.qml
        data/packagers.xml
)

target_include_directories(BufferX PRIVATE src)
target_link_libraries(BufferX PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick Qt6::QuickControls2 Qt6::Widgets OpenSSL::Crypto)

add_executable(BufferXTests
    tests/BufferXTests.cpp
    ${BUFFERX_CORE_SOURCES}
)

target_include_directories(BufferXTests PRIVATE src)
target_compile_definitions(BufferXTests PRIVATE BUFFERX_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}")
target_link_libraries(BufferXTests PRIVATE Qt6::Core Qt6::Widgets OpenSSL::Crypto)

add_custom_command(TARGET BufferX POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        $<TARGET_RUNTIME_DLLS:BufferX>
        $<TARGET_FILE_DIR:BufferX>
    COMMAND_EXPAND_LISTS
)

add_custom_command(TARGET BufferXTests POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        $<TARGET_RUNTIME_DLLS:BufferXTests>
        $<TARGET_FILE_DIR:BufferXTests>
    COMMAND_EXPAND_LISTS
)

add_test(NAME BufferXTests COMMAND BufferXTests)
