# Architecture

BufferX is a banking operator workbench built as a **React frontend over a C++ domain core**, shipped
as a Tauri desktop app and deployable unchanged as a static web app.

The Qt/QML desktop application was removed in 2.0. The domain library it was built on was kept — it
carries the ISO 8583 codecs, PIN block algorithms, and legacy host compatibility behaviour, all of
which are expensive to re-derive and were already covered by tests.

## Layout

```
core/           C++17 domain library + the C ABI over it
  include/bufferx/   public headers  (the only thing consumers include)
  src/               implementations
  abi/               JSON envelope + bufferx_invoke dispatcher
  tests/             verification executables
app/            React + TypeScript frontend (Vite, Tailwind v4)
src-tauri/      Rust desktop shell: FFI to the C ABI + host-only capabilities
data/           packager definitions (XML)
docs/           this file, the engine contract, the UX spec, the design system
scripts/        build and code-generation helpers

build/          every generated artifact, and nothing else (git-ignored)
  cmake/          CMake configure + C++ test binaries
  rust/           Cargo target directory, including the shipped executable
  web/            Vite bundle, embedded into the desktop binary at build time
```

## Dependency direction

```
app (React)  ─┬─► WASM build of core      (browser, and inside the Tauri webview)
              └─► Tauri IPC ─► Rust ─► C ABI ─► BufferXCore   (desktop)
```

Dependencies point one way only. `BufferXCore` knows nothing about JSON, the ABI, Rust, or the UI.
The ABI knows the core but not the host. The host knows the ABI but not the domain.

## The three layers

### `BufferXCore`

The banking domain: ISO 8583 encode/decode, packager loading, MAC, PIN blocks, PIN verification and
translation, symmetric crypto, RSA, TLV and fixed-width LTV, IranSystem text conversion, and banking utilities.

Its only dependency is a crypto provider (currently OpenSSL). It has **no** dependency on Qt, on a UI
framework, on a transport, or on the platform. That is deliberate and load-bearing: it is what allows
the same sources to compile for the native host and for `wasm32-emscripten`.

Two pieces used to break this rule and were replaced in 2.0:

- `PackagerLoader` used `QXmlStreamReader` → replaced by `XmlLite`, a ~380-line reader covering the
  subset configuration XML actually uses. It refuses unknown entities rather than passing them
  through, and does not resolve external entities at all.
- `IranSystem` used `QString` and, worse, Win32 `MultiByteToWideChar` — which meant every non-Windows
  build returned *"IranSystem conversion is only available on Windows builds."* It now uses
  `TextCodec`, a portable Windows-1256 codec whose table is **generated from the Win32 API it
  replaced** (`scripts/generate_cp1256_table.cpp`) and verified byte-for-byte against it by
  `core/tests/Cp1256DifferentialTest.cpp`. IranSystem conversion now works on every platform. EBCDIC (code page 037) conversion — also formerly Win32-only via `MultiByteToWideChar` — was ported the same way: table generated from the Win32 API, verified byte-for-byte against it.

Core APIs return typed result structs with `ok` and `error`. They never throw across module
boundaries and never format JSON.

### The C ABI

One entry point, one envelope, versioned:

```c
bufferx_session* bufferx_open(void);
void             bufferx_close(bufferx_session*);
char*            bufferx_invoke(bufferx_session*, const char* request_json);
void             bufferx_string_free(char*);
const char*      bufferx_version(void);
```

`{ "v": 1, "op": "...", "args": {...} }` in, `{ "ok": true, "data": {...} }` or
`{ "ok": false, "error": { "code", "message" } }` out. See [ENGINE_CONTRACT.md](ENGINE_CONTRACT.md)
for the full operation catalogue and error codes.

Design rules:

- **State lives in the session, not in globals.** The loaded packager registry is per-session, so two
  windows or two browser tabs cannot corrupt each other's state. The previous Qt adapter kept this in
  process globals.
- **No exception crosses the boundary.** Every handler is wrapped; failures become `INTERNAL` errors.
- **`bufferx_invoke` never returns NULL.** An allocation failure still produces a valid error envelope.
- **Errors never contain secrets.** They describe structure ("key must be 16 hex characters"), never
  values.

### Hosts

The frontend talks to an `EngineTransport` and does not know which one it has:

| Host | Transport | Gets |
|---|---|---|
| Browser | WASM module in-tab | everything computational |
| Desktop (Tauri) | IPC → Rust → C ABI | the same, plus raw TCP, native file dialogs, key files, and listing a folder of saved buffers |

Capabilities are negotiated at startup rather than assumed. Panels that need a missing capability are
**disabled with an explanation**, not hidden — an operator should be able to see that the ISO host
tester exists and learn why it needs the desktop app.

## Tool and host state

Desktop startup checks the shared application update policy before constructing the banking engine
or any workspace webview. The primary request runs in the app; unless it confirms a block, a separate
hidden native checker requests the secondary. Both use `src-tauri/policy-check` for parsing and HTTP.
Only a valid block stops startup; other outcomes allow it. The checker has a fixed production URL,
bounded lifetime, and no persisted state. `build.rs` builds it and Tauri bundles it as an external binary.
Deployment instructions are owned by the sibling License repository's `README.md` and `BufferX.md`.
Run `pwsh -File scripts/verify-startup-policy.ps1` for isolated HTTP/process integration tests.

The packager builder produces XML definitions and applies them through `packager.loadXml`, merging
the current registry first so unrelated definitions survive. LTV parsing/building lives in
`core/src/Ltv.cpp` and is exposed through `ltv.parse` and `ltv.build` in the shared ABI.

JSON inspection is frontend-only. A dedicated worker validates source and returns a tree with source
ranges; formatting uses the original scalar tokens to avoid rounding numbers or losing duplicate
properties. CodeMirror renders the source and errors, and the structure table virtualizes rows.

Workspace persistence explicitly allows tool identities, active tool, split preferences, and dock
width. Payloads remain in memory. Saved-buffer library persistence stores a folder override and
annotations; `default_buffer_directory` resolves the portable default beside the executable at runtime.
TCP framing and socket deadlines remain in the Rust host. See [TOOLS_GUIDE.md](TOOLS_GUIDE.md) for
operator workflows and limits.

## Change rules

- New domain behaviour goes in `BufferXCore` with a direct test, before it is exposed as an operation.
- Adding an operation must not require touching either transport — that is the point of the envelope.
- Keep transport concerns (TCP framing) out of the cryptographic and ISO codecs.
- Packager definitions stay data. Host-specific behaviour belongs behind an explicit compatibility
  option, not a condition inside the generic codec.
- Treat PINs and keys as sensitive throughout: never logged, never persisted, never in a URL, never
  echoed back in an error. BufferX is a test tool, not an HSM, and should not be mistaken for one.
