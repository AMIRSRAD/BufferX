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
- Added a default-off `Legacy ATM Engine` mode with engine-compatible IFB/IFA encoding,
  binary bitmaps, packed MTI/length prefixes, framing profiles, and partial-MAC field scope.
- Added PIN handling:
  - ISO-0, ISO-1, and ISO-3 creation/decode
  - AES ISO-4 encryption/decryption
  - 3DES-ECB PIN block encryption
  - 3DES-ECB PIN block decryption
  - field 52 load/apply helpers
  - Visa PVV generation
  - IBM 3624 offset calculation/verification
  - AlmasPlus ANSI/ISO-1 encrypted PIN-block translation
  - DES and two-key 3DES source/destination transforms
  - destination-only TSN-DES compatibility
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
  - OAEP SHA-1/SHA-256 and PKCS#1 v1.5 RSA encryption/decryption
- Added TLV handling:
  - parse TLV hex
  - build primitive TLV nodes
  - build constructed TLV nodes from child TLV hex
  - tree and flat inspection views
  - validation and editable nested XML round trips
- Added banking conversion/key tools for BCD, XOR, Base64, hashes, Luhn, parity,
  random keys, KCV, and EBCDIC.
- Added an ISO TCP tester with none/ASCII/binary framing and loopback integration tests.
- Added IranSystem conversion with UTF-8, ANSI, and Hex handling.
- Added an explicit ATM-engine IranSystem profile matching AlmasPlus `W2IS` shaping,
  Persian-run justification, digit handling, lam-alef collapsing, and direct reverse mapping.

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

## Remaining Product Work

- Add institution-specific ISO profiles as real host specifications become available.
- RSA operations currently accept PEM text rather than loading key files directly.
- Nested TLV editing is XML-based rather than a drag-and-drop tree.
- Crypto and clear-PIN operations remain test tooling, not an HSM/SCD replacement.
- No installer or packaged release workflow exists yet.

## Next Tasks

1. Add key-file load helpers for RSA private/public keys.
2. Add institution-specific MAC presets when their specifications are supplied.
3. Add a drag-and-drop TLV tree editor if XML editing is insufficient.
4. Add installer/release packaging for Windows.
5. Expand screenshots and usage examples in the README.

## Quality Bar

- Main workflows should remain paste-first and fast.
- Supported formats must be explicit and tested.
- Unsupported formats should fail with actionable errors.
- UI sections should stay separate and discoverable.
- Documentation should match the actual released app state.
