# BufferX

BufferX is a Qt 6 desktop workbench for ISO 8583 buffers and banking-adjacent operator tasks.

It is built around the practical workflow of:

- pasting a raw buffer and decoding it into fields
- editing fields and rebuilding the buffer
- switching between text and hex handling
- applying or removing message length headers
- enabling exact ATM-engine ISO encoding when a legacy host requires it
- calculating and verifying MAC values
- creating, decoding, encrypting, and decrypting PIN blocks
- running standalone crypto transforms
- signing and verifying RSA-SHA payloads with Base64 signatures
- encrypting and decrypting RSA payloads with OAEP or PKCS#1 v1.5
- parsing and building TLV payloads
- sending framed ISO requests to a TCP endpoint
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
- default-off `Legacy ATM Engine` ISO mode for ATM-engine-compatible BCD, binary bitmap,
  variable-length prefix, framing, and partial-MAC behavior
- buffer save/load as JSON
- MAC panel for calculate and verify flows
- PIN panel for:
  - ISO-0, ISO-1, and ISO-3 PIN block creation/decode
  - AES ISO-4 PIN block encryption/decryption
  - 3DES-ECB PIN block encryption
  - 3DES-ECB PIN block decryption
  - field 52 load/apply helpers
  - Visa PVV generation
  - IBM 3624 offset calculation and verification
  - AlmasPlus-compatible encrypted PIN-block translation
  - ATM ANSI/ISO-0 and engine-specific ISO-1 formats
  - DES and two-key 3DES source/destination keys
  - destination-only engine TSN-DES output
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
  - RSA OAEP SHA-1/SHA-256 encryption/decryption
  - RSA PKCS#1 v1.5 encryption/decryption
- TLV panel for:
  - TLV parsing
  - single-node TLV building
  - constructed TLV building from child TLV hex
  - tree and flat views
  - TLV validation
  - nested TLV-to-XML and XML-to-TLV editing
- banking tools for BCD, XOR, Base64, hashes, Luhn, DES parity, random keys,
  KCV, and ASCII/EBCDIC conversion
- ISO TCP tester with none/ASCII/binary framing, timeouts, and wire/body views
- IranSystem conversion panel with UTF-8 / ANSI / Hex handling
  - normalized round-trip profile
  - exact AlmasPlus `ToIranSystem` / `FromIranSystem` compatibility profile
- in-app info/license panel
- automated backend and integration-style tests

## Build

Requirements:

- CMake 3.23+
- Visual Studio 2022 toolchain on Windows
- Qt 6 with:
  - `Core`
  - `Gui`
  - `Network`
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

The build also produces two reusable static-library targets:

- `BufferX::Core` contains the presentation-independent banking and buffer logic.
- `BufferX::QtAdapter` contains the current QObject/QML, file-dialog, TCP, and JSON bridge.

See [Backend Architecture](docs/BACKEND_ARCHITECTURE.md) for the dependency rules and the planned Tauri/React integration boundary.

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
- Visa PVV and IBM 3624 paths
- DES/AES crypto backend paths
- RSA-SHA sign/verify paths
- TLV parse and build paths
- nested TLV XML round trips and validation
- loopback TCP request/response framing
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
  - thin QML-facing bridge and JSON API
- `src/BufferXCore.h`
  - supported include entry point for native backend consumers
- `docs/BACKEND_ARCHITECTURE.md`
  - core/adapter boundary and future UI bridge rules
- `src/Iso8583.*`
  - core encode/decode logic
- `src/Packager*`
  - packager types and XML loader
- `src/Mac.*`
  - MAC engine
- `src/PinBlock.*`
  - ISO-0, ISO-1, ISO-3, and ISO-4 PIN block support
- `src/PinVerification.*`
  - Visa PVV and IBM 3624 utilities
- `src/PinTranslation.*`
  - ATM-engine ANSI/ISO-1 and DES/3DES/TSN-DES translation
- `src/BankingTools.*`
  - banking conversion, hash, key, and validation helpers
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

- legacy mode is intentionally off by default; enable it only for ATM-engine-compatible hosts
- external networks can still have institution-specific field and MAC rules outside the supplied XML
- RSA-SHA support expects PEM keys and Base64 signatures
- nested TLV editing uses XML rather than a drag-and-drop tree editor
- cryptographic and clear-PIN tools are for controlled testing only; BufferX is not an HSM,
  secure cryptographic device, or production key-management system
- there is no installer/package flow yet

## License

This repository is proprietary.

Copyright (c) 2026 Amirsalar Saberi rad. All rights reserved.

Website: https://amirsrad.ir

## Status

BufferX is a banking-message workbench for ISO 8583 decoding/building, legacy ATM-engine compatibility, MAC and PIN work, crypto and RSA operations, TLV editing, banking conversions, IranSystem conversion, and framed TCP testing.
