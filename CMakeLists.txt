cmake_minimum_required(VERSION 3.23)
project(BufferX LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
enable_testing()

find_package(Qt6 REQUIRED COMPONENTS Core Gui Network Qml Quick QuickControls2 Widgets)
find_package(OpenSSL REQUIRED)

set(BUFFERX_CORE_SOURCES
    src/BankingTools.cpp
    src/Crypto.cpp
    src/PinBlock.cpp
    src/PinVerification.cpp
    src/PinTranslation.cpp
    src/RsaSha.cpp
    src/Iso8583.cpp
    src/Mac.cpp
    src/Packager.cpp
    src/PackagerLoader.cpp
    src/Tlv.cpp
    src/Hex.cpp
    src/IranSystem.cpp
)

add_library(BufferXCore STATIC ${BUFFERX_CORE_SOURCES})
add_library(BufferX::Core ALIAS BufferXCore)
set_target_properties(BufferXCore PROPERTIES
    AUTOMOC OFF
    POSITION_INDEPENDENT_CODE ON
)
target_include_directories(BufferXCore PUBLIC src)
target_link_libraries(BufferXCore PUBLIC Qt6::Core OpenSSL::Crypto)

add_library(BufferXQtAdapter STATIC src/Backend.cpp)
add_library(BufferX::QtAdapter ALIAS BufferXQtAdapter)
set_target_properties(BufferXQtAdapter PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(BufferXQtAdapter PUBLIC src)
target_link_libraries(BufferXQtAdapter
    PUBLIC BufferXCore Qt6::Core
    PRIVATE Qt6::Network Qt6::Widgets
)

qt_add_executable(BufferX WIN32
    main.cpp
    assets/appicon.rc
)

qt_add_resources(BufferX "resources"
    PREFIX "/"
    FILES
        assets/bank.png
        ui/Main.qml
        data/packagers.xml
)

target_link_libraries(BufferX PRIVATE
    BufferXQtAdapter
    Qt6::Gui
    Qt6::Qml
    Qt6::Quick
    Qt6::QuickControls2
    Qt6::Widgets
)

add_executable(BufferXTests
    tests/BufferXTests.cpp
)

target_compile_definitions(BufferXTests PRIVATE BUFFERX_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}")
target_link_libraries(BufferXTests PRIVATE BufferXQtAdapter Qt6::Network)

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
