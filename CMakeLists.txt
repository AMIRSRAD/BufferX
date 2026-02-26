cmake_minimum_required(VERSION 3.23)
project(BufferX LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Core Gui Qml Quick QuickControls2 Widgets)

qt_add_executable(BufferX
    main.cpp
    src/Backend.cpp
    src/Iso8583.cpp
    src/Packager.cpp
    src/PackagerLoader.cpp
    src/Hex.cpp
)

qt_add_resources(BufferX "resources"
    PREFIX "/"
    FILES
        ui/Main.qml
        data/packagers.xml
)

target_include_directories(BufferX PRIVATE src)
target_link_libraries(BufferX PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick Qt6::QuickControls2 Qt6::Widgets)
