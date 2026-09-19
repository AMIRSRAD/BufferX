cmake_minimum_required(VERSION 3.22)
project(BufferX LANGUAGES CXX VERSION 2.0.0)

# BufferX is a React + Tauri application over a C++ banking core.
#
#   app/        TypeScript frontend (Vite)         -- built with pnpm
#   src-tauri/  Rust desktop shell                 -- built with cargo
#   core/       C++ domain library                 -- built here
#   core/abi/   C ABI consumed by Rust and by WASM -- built here
#
# The Qt/QML desktop application this replaced has been removed; the domain
# library it was built on was kept and is now dependency-free.

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(BUFFERX_BUILD_TESTS "Build the C++ verification executables" ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

enable_testing()

find_package(OpenSSL REQUIRED)

add_subdirectory(core)

if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/core/abi/CMakeLists.txt)
    add_subdirectory(core/abi)
endif()
