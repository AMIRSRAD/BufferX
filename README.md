# BufferX

BufferX is a Qt 6 desktop workbench for ISO 8583 buffers and banking-adjacent operator tasks.

It is built around the practical workflow of:

- pasting a raw buffer and decoding it into fields
- editing fields and rebuilding the buffer
- switching between text and hex handling
- applying or removing message length headers
- calculating and verifying MAC values
- creating, decoding, encrypting, and decrypting PIN blocks
- running standalone crypto transforms
- signing and verifying RSA-SHA payloads with Base64 signatures
- parsing and building TLV payloads
- working with IranSystem text conversion

## Screenshot

![BufferX main window](ss/1.png)

## Current Feature Set

- Qt/QML desktop UI with embedded application icon
- XML-driven packager definitions from `data/packagers.xml`
- ISO 8583 encode/decode support for:
  - `MTI + bitmap + fields`
  - `bitmap first, no MTI`
  - `sequential fields, no bitmap`
- buffer input in text or hex
- field-level editing with per-field hex helpers
- optional ASCII and binary length headers
- buffer save/load as JSON
- MAC panel for calculate and verify flows
- PIN panel for:
  - ISO-0 PIN block creation
  - ISO-0 PIN block decode
  - 3DES-ECB PIN block encryption
  - 3DES-ECB PIN block decryption
  - field 52 load/apply helpers
- crypto panel for:
  - `DES-ECB`
  - `DES-CBC`
  - `3DES-ECB`
  - `3DES-CBC`
  - `AES-128-ECB`
  - `AES-128-CBC`
  - `AES-256-ECB`
  - `AES-256-CBC`
- RSA-SHA panel for:
  - PEM private/public keys
  - `SHA-1`
  - `SHA-256`
  - `SHA-512`
  - Base64 signature output/input
- TLV panel for:
  - TLV parsing
  - single-node TLV building
  - constructed TLV building from child TLV hex
  - tree and flat views
- IranSystem conversion panel with UTF-8 / ANSI handling
- in-app info/license panel
- automated backend and integration-style tests

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

`cmake-build-debug/BufferX.exe`

### Release

```powershell
cmake -S . -B cmake-build-release
cmake --build cmake-build-release --target BufferX --config Release
```

Release executable:

`cmake-build-release/BufferX.exe`

The repo also currently has a second local release tree:

```powershell
cmake --build cmake-build-release-vs2026 --target BufferX --config Release
```

## Tests

Build and run:

```powershell
cmake --build cmake-build-release --target BufferXTests --config Release
cmake-build-release\BufferXTests.exe
```

Coverage currently includes:

- hex parsing and formatting
- XML loader behavior and failure cases
- ISO 8583 encode/decode paths
- packager layout handling
- MAC calculation and verification paths
- PIN block creation/decode/encrypt/decrypt paths
- DES/AES crypto backend paths
- RSA-SHA sign/verify paths
- TLV parse and build paths
- IranSystem conversion paths
- save/load buffer persistence

## Packager XML

Packager definitions live in:

`data/packagers.xml`

The loader reads metadata such as:

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
- `src/Mac.*`
  - MAC engine
- `src/PinBlock.*`
  - ISO-0 PIN block support
- `src/Crypto.*`
  - standalone cipher transforms
- `src/RsaSha.*`
  - RSA-SHA sign/verify support
- `src/Tlv.*`
  - TLV parsing and encoding helpers
- `src/IranSystem.*`
  - IranSystem conversion support
- `src/Hex.*`
  - hex utilities
- `assets/`
  - application icon assets
- `tests/BufferXTests.cpp`
  - test harness
- `ss/`
  - README screenshots

## Known Limits

- some binary and BCD semantics are still simplified for workstation use
- not every historical ISO 8583 dialect is modeled
- MAC behavior is practical and useful, but not every network-specific rule is implemented
- PIN support currently focuses on ISO-0 and 3DES-ECB PIN block handling
- RSA-SHA support expects PEM keys and Base64 signatures
- TLV build support is currently a practical single-node/constructed-payload builder, not a full nested visual editor
- crypto tooling is an operator utility, not a full HSM or key-management stack
- there is no installer/package flow yet

## License

This repository is proprietary.

Copyright (c) 2026 Amirsalar Saberi rad. All rights reserved.

Website: https://amirsrad.ir

## Status

BufferX is no longer just a parser prototype. It is now a multi-tool desktop utility for ISO 8583 decoding/building, MAC work, PIN block handling, crypto transforms, RSA-SHA signatures, TLV inspection/building, and IranSystem conversion.
