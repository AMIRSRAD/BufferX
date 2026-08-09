# Backend Architecture

BufferX separates banking behavior from the desktop UI. This boundary must remain intact when the UI is replaced or supplemented.

## Targets

### `BufferXCore`

The reusable native library. It owns ISO 8583, packager loading, MAC, PIN blocks, PIN verification and translation, symmetric crypto, RSA, TLV, IranSystem, and banking utility behavior.

Consumers should link `BufferX::Core` and include `BufferXCore.h` or the smallest individual domain header they need. Core APIs use typed result structures and do not know about QML, dialogs, sockets, or JSON presentation.

The core currently depends on Qt Core only for XML and IranSystem Unicode support, plus OpenSSL for cryptography. It does not depend on Qt GUI, QML, Quick, Widgets, or Network.

### `BufferXQtAdapter`

The current desktop adapter. `Backend` exposes the existing `Q_INVOKABLE` contract, translates QML values and JSON into core calls, owns loaded packager state, and provides desktop-only file dialog and TCP helpers.

No ISO, PIN, MAC, TLV, or cryptographic algorithm should be implemented in this target. New domain behavior belongs in `BufferXCore`; `Backend` should only validate presentation input, invoke the domain API, and serialize the result.

### `BufferX`

The Qt Quick application. It owns startup, resources, and QML. It links the adapter but contains no banking logic.

## Future UI Bridge

A Tauri or React shell should not call `Backend` or depend on Qt QML. Use one of these bridge shapes while keeping `BufferXCore` unchanged:

1. A narrow Rust/C++ FFI layer with owned input/output buffers and explicit error values.
2. A local sidecar process exposing versioned JSON requests over standard input/output or a local socket.
3. Rust commands that call a small C ABI wrapper around `BufferXCore`.

The bridge should provide versioned request/response DTOs. Do not expose C++ containers, exceptions, QObject pointers, or OpenSSL objects across an FFI boundary. Secrets such as PINs and keys must not be logged, persisted in bridge messages longer than necessary, or returned in diagnostic errors.

## Dependency Direction

```text
Qt Quick UI -> BufferXQtAdapter -> BufferXCore
Future UI   -> Future bridge    -> BufferXCore
```

Dependencies must only point to the right. `BufferXCore` must never include `Backend.h` or any UI header.

## Change Rules

- Preserve the existing QML method names and compact JSON shapes until the Qt UI is retired.
- Add or change algorithms in a domain module with direct tests before exposing them through an adapter.
- Keep transport concerns such as TCP framing outside cryptographic and ISO codecs.
- Return explicit typed results from core code; convert errors to JSON only at the adapter edge.
- Keep packager definitions as data and avoid host-specific conditions in the generic codec unless enabled by an explicit compatibility option.
- Treat PINs and cryptographic keys as sensitive even though BufferX is a test utility.
