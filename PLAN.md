# BufferX Status and Roadmap

## Current Goal

Keep BufferX as a complete desktop workbench for ISO 8583 buffer handling and related banking/operator utilities.

The app is now beyond the original parser prototype. It includes the core ISO 8583 workflow plus dedicated tools for MAC, PIN blocks, crypto transforms, RSA-SHA signatures, TLV parsing/building, and IranSystem conversion.

## Completed Work

### Core Parser and Packagers

- Added automated tests wired through CMake.
- Replaced fragile XML parsing with Qt XML loading.
- Added explicit packager field type mapping and clearer unsupported-type handling.
- Added numeric validation paths.
- Improved codec behavior around packager metadata and non-default layouts.
- Preserved the main paste-buffer workflow for decoding, editing, and rebuilding buffers.

### UI Workflow

- Restored a visible main buffer paste area.
- Added footer navigation for the main tool sections.
- Added visible field decoding and field editing flow.
- Added JSON buffer save/load workflow.
- Improved text sizing and contrast for dark UI use.
- Embedded the application icon in the executable and window.

### Operator Tools

- Added MAC calculation and verification.
- Added PIN handling:
  - ISO-0 PIN block creation
  - ISO-0 PIN block decode
  - 3DES-ECB PIN block encryption
  - 3DES-ECB PIN block decryption
  - field 52 load/apply helpers
- Added encryption/decryption tools:
  - DES-ECB
  - DES-CBC
  - 3DES-ECB
  - 3DES-CBC
  - AES-128-ECB
  - AES-128-CBC
  - AES-256-ECB
  - AES-256-CBC
- Added RSA-SHA signing and verification:
  - PEM private/public key input
  - SHA-1, SHA-256, and SHA-512
  - Base64 signature output/input
- Added TLV handling:
  - parse TLV hex
  - build primitive TLV nodes
  - build constructed TLV nodes from child TLV hex
  - tree and flat inspection views
- Added IranSystem conversion with UTF-8 and ANSI-oriented handling.

### Documentation and Repository

- Added GitHub README with feature list, build steps, tests, screenshots, layout, limits, and ownership details.
- Added proprietary license file.
- Added creator/info section in the app:
  - Amirsalar Saberi rad
  - https://amirsrad.ir
- Added screenshot folder for README images.

## Build and Test

### Debug Build

```powershell
cmake -S . -B cmake-build-debug
cmake --build cmake-build-debug --target BufferX --config Debug
```

### Release Build

```powershell
cmake -S . -B cmake-build-release
cmake --build cmake-build-release --target BufferX --config Release
```

### Secondary Release Tree

```powershell
cmake --build cmake-build-release-vs2026 --target BufferX --config Release
```

### Tests

```powershell
cmake --build cmake-build-release --target BufferXTests --config Release
cmake-build-release\BufferXTests.exe
```

## Current Limitations

- Binary and BCD field semantics are still simplified for workstation use.
- Not every historical ISO 8583 dialect is modeled.
- MAC handling is practical, but not every network-specific MAC scope rule is represented.
- PIN support currently focuses on ISO-0 and 3DES-ECB PIN block handling.
- RSA-SHA expects PEM keys and Base64 signatures.
- TLV build support is useful for primitive and constructed payloads, but it is not yet a full nested visual editor.
- Crypto tools are operator utilities, not a replacement for an HSM or complete key-management stack.
- No installer or packaged release workflow exists yet.

## Next Tasks

1. Add a nested TLV builder/editor with add/remove/reorder child nodes.
2. Extend PIN handling with ISO-1, ISO-3, and ISO-4 formats.
3. Add optional PVV and IBM 3624 PIN verification helpers.
4. Add key-file load helpers for RSA private/public keys.
5. Add clearer MAC profile presets for common network rules.
6. Tighten binary and BCD wire-format behavior and document exact field encoding rules.
7. Add installer/release packaging for Windows.
8. Expand screenshots and usage examples in the README.

## Quality Bar

- Main workflows should remain paste-first and fast.
- Supported formats must be explicit and tested.
- Unsupported formats should fail with actionable errors.
- UI sections should stay separate and discoverable.
- Documentation should match the actual released app state.
