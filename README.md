
# BufferX

BufferX is a Qt 6 desktop tool for working with ISO 8583-style messages and related binary payloads.

It is built for the day-to-day workflow of:

- pasting a raw buffer and decoding it into fields
- editing fields and rebuilding a buffer
- switching between text and hex views
- applying optional message length headers
- calculating and verifying MAC values
- running standalone crypto transforms such as DES, 3DES, and AES

## Current Scope

BufferX supports three packager layout modes from `data/packagers.xml`:

- `MTI + bitmap + fields`
- `bitmap first, no MTI`
- `sequential fields, no bitmap`

The current implementation is aimed at practical workstation use rather than full ISO 8583 spec coverage across every historical dialect.

## Features

- Qt/QML desktop UI
- XML-driven packager definitions
- encode/decode for multiple packager layouts
- ASCII and binary length header support
- text and hex buffer input/output
- save/load buffer JSON files
- field-level editing
- MAC calculation and verification tools
- standalone crypto panel for:
  - `DES-ECB`
  - `DES-CBC`
  - `3DES-ECB`
  - `3DES-CBC`
  - `AES-128-ECB`
  - `AES-128-CBC`
  - `AES-256-ECB`
  - `AES-256-CBC`
- test executable wired into `ctest`

<img width="1510" height="880" alt="6" src="https://github.com/user-attachments/assets/c2539c52-25db-49cf-aafb-895e487cc625" />


## Build

Requirements:

- CMake 3.23+
- Visual Studio 2022 toolchain on Windows
- Qt 6 with:
  - `Core`
  - `Gui`
  - `Qml`
  - `Quick`
  - `QuickControls2`
  - `Widgets`
- OpenSSL

### Debug

```powershell
cmake -S . -B cmake-build-debug
cmake --build cmake-build-debug --target BufferX --config Debug
```

Debug executable:

`C:\Users\a.saberi\CLionProjects\BufferX\cmake-build-debug\BufferX.exe`

### Release

```powershell
cmake -S . -B cmake-build-release
cmake --build cmake-build-release --target BufferX --config Release
```

Release executable:

`C:\Users\a.saberi\CLionProjects\BufferX\cmake-build-release\BufferX.exe`

## Tests

Build and run:

```powershell
cmake --build cmake-build-debug --target BufferXTests --config Debug
ctest --test-dir cmake-build-debug --output-on-failure -C Debug
```

Coverage currently includes:

- hex parsing/formatting
- packager type mapping
- XML loader behavior and failure cases
- encode/decode round-trips
- numeric sanitization
- non-standard packager layouts
- MAC calculation/verification backend paths
- crypto backend paths
- save/load buffer persistence

## MAC Handling

BufferX currently implements MAC tooling as a separate operator workflow:

1. prepare fields in the main editor
2. open the `MAC` panel
3. choose the MAC field id
4. enter the key
5. calculate or verify
6. apply the calculated MAC back into the field list
7. build the final buffer

The current MAC engine uses an ANSI X9.19 retail MAC style implementation with ISO 9797 method 1 / method 2 padding options.

Packager metadata such as `MacMethod` and `MacSize` is exposed to the UI, but not every semantic variant of `FULL` vs `PARTIAL` is interpreted beyond the current workflow.

## Packager XML

Packager definitions live in:

`data/packagers.xml`

The loader reads packager metadata including:

- `Name`
- `MacMethod`
- `MacSize`
- `BitmapIndex`
- `SecondPartBitmap`
- `FieldCount`
- `LenFormat`
- `LenLen`

Field definitions include:

- `FieldId`
- `FieldType`
- `FieldLength`
- `FieldDesc`
- `Flags`

## Known Limitations

- Binary and BCD semantics are still simplified in places. Some field types are treated as practical workstation encodings rather than strict on-the-wire BCD implementations.
- `SecondPartBitmap`, `LenFormat`, and some packager metadata still need deeper protocol-specific handling.
- MAC support is real, but not every network-specific MAC scope rule is modeled.
- Crypto tooling is meant as an operator utility panel, not a full HSM or key-management workflow.
- The UI is workstation-focused and not packaged yet as an installer.

## Project Layout

- `main.cpp`
  - Qt application entry point
- `ui/Main.qml`
  - main desktop interface
- `src/Backend.*`
  - QML-facing bridge and JSON API
- `src/Iso8583.*`
  - core encode/decode logic
- `src/Packager*`
  - packager types and XML loader
- `src/Hex.*`
  - hex utilities
- `src/Mac.*`
  - MAC engine
- `src/Crypto.*`
  - standalone cipher transforms
- `tests/BufferXTests.cpp`
  - test harness

## Status

This repository is no longer just a prototype parser. It now has tests, a safer XML loader, broader packager handling, MAC tooling, and a separate crypto workbench.
