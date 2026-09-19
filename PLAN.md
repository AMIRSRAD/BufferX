# BufferX Status and Roadmap

## Current goal

Ship 2.0: the same banking workbench, rebuilt on a stack that can run on the desktop *and* in a
browser, with an interface designed for an operator who lives in it all day.

## 2.0 — the rewrite

### What changed and why

The Qt/QML app had reached the end of its shape. Tools lived in mutually exclusive footer popovers,
so an ISO investigation — which is inherently multi-tool — forced the operator to memorise values
between panel toggles. The UI was a single 3,897-line QML file positioned in absolute window pixels,
which could not be made responsive and could never run on the web.

The banking logic had the opposite problem: it was good, tested, and worth keeping. So 2.0 replaced
the interface and kept the engine.

### Done

**Core made dependency-free** — the two files that still touched Qt were replaced:
- `PackagerLoader` now uses `XmlLite`, a purpose-built reader for the XML subset configuration files
  actually use. Verified against the real `data/packagers.xml` (32 packagers) plus malformed input.
- `IranSystem` now uses `TextCodec` instead of `QString` and Win32. The Windows-1256 table is
  *generated from the Win32 API it replaces* and proven byte-identical by a differential test across
  all 256 decode bytes and 1,674 encode codepoints. Persian conversion works off-Windows for the
  first time.
- EBCDIC (code page 037) got the same treatment and the same differential proof.
- `BufferXCore` now depends on nothing but C++17 and OpenSSL, and it is also compiled to
  WebAssembly — the browser build runs the identical banking logic, not a reimplementation.

**Qt removed** — `ui/Main.qml`, `Backend.cpp/h`, `main.cpp`, and every Qt reference in the build.

**New architecture** — `core/` (C++ + C ABI), `app/` (React), `src-tauri/` (Rust shell), connected by
one versioned JSON envelope. All build output — CMake, Cargo, and Vite — now lands in a single
git-ignored `build/` folder rather than three scattered locations. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), which documents the real, as-shipped 40-operation
engine contract.

**Full interface shipped**, not just the shell: persistent rail (labeled by default — an earlier
icon-only default asked the operator to learn a vocabulary for MAC, PIN, Crypto, and RSA, which have
no conventional icon), tabbed buffer documents, a tool dock that no longer occludes the workspace so
MAC and PIN can stay open beside the field table they act on, a command palette, a Problems drawer
that correctly retracts stale entries when the condition that raised them is resolved, dark and light
themes at parity with verified contrast ratios, two density modes, and self-hosted typefaces (Inter,
JetBrains Mono, and Vazirmatn for Persian) rather than silently falling back to whatever the OS had.

**Every tool panel**: the buffer workspace (paste, decode, edit, rebuild, hex view with per-field
colour and bidirectional hover linking, auto-detected length headers), MAC, PIN, Crypto, RSA, TLV,
Toolbox, Network (TCP host tester), IranSystem, Settings, About, and a saved-buffers library — a
folder of `.bxb` documents the operator curates, with only the folder path and per-file labels held
by the app; the messages themselves stay in the operator's own files, never in application storage.

**Specifications retained with an honest status** —
[ENGINE_CONTRACT.md](docs/ENGINE_CONTRACT.md), [UX_SPEC.md](docs/UX_SPEC.md), and
[DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) were written before implementation and, like any spec,
drifted from what shipped in real ways (op names, a few UI defaults, the mono typeface). Rather than
leave that silently wrong, each now carries a top-of-file notice naming exactly what changed and
pointing at the real source — including a generated, source-of-truth op index at the end of
`ENGINE_CONTRACT.md`.

### Remaining

1. **Port the legacy regression suite.** `core/tests/legacy-qt/BufferXTests.cpp` still holds the ISO,
   MAC, PIN, crypto, RSA, and TLV vectors and does not build — it links the deleted Qt adapter. See
   `core/tests/legacy-qt/README.md` for what has already been ported elsewhere and what has not. This
   is the highest-value item left: it is the safety net for everything above.
2. **Wire the WebAssembly build into a repeatable process.** The pipeline
   (`scripts/setup-emsdk.*`, `scripts/build-openssl-wasm.sh`, `scripts/build-wasm.sh`) works — it has
   been run successfully and produces a current, non-stale `bufferx_core.wasm` — but it is a manual,
   local step on top of a ~1.5 GB toolchain, and its output is git-ignored by design. It needs either
   a CI job that runs it and publishes the artifact, or a documented decision that the web build is
   built once per release rather than per clone.
3. **Installer and release packaging.** Tauri can produce MSI/NSIS/deb/AppImage/dmg via `pnpm build`;
   none is wired to an actual release workflow yet.
4. **Institution-specific ISO profiles and MAC presets**, once real host specifications are available.
5. **Drag-and-drop TLV tree editing** — nested editing is still XML-based.

## Quality bar

- The paste-first buffer workflow stays the fastest path through the app.
- Supported formats are explicit and tested; unsupported ones fail with actionable errors.
- Every capability the host cannot provide is disabled with an explanation, never silently missing.
- PINs and keys are never persisted, logged, or placed in a URL.
- Documentation matches the shipped state — and where a design doc predates the code, it says so
  rather than letting a reader assume it is current.
