# BufferX Engine Contract v1

> **This document is the pre-implementation design spec, not a live reference.**
> It was written before `core/abi/bufferx_abi.cpp` existed, to pin down the shape of the boundary
> before code was written against it. The build that shipped deviated from it in real ways — some op
> names changed (`sys.capabilities` → `engine.capabilities`, `pin.ibm3624Verify` → `pin.verifyIbm3624`,
> `text.atmIranSystemToUnicode` → `text.atmEngineIranSystemToUnicode`), some ops described here were
> never built as separate ops (`engine.setLegacyMode`/`getLegacyMode`/`reset` — legacy mode is instead
> a plain `legacyEngine: bool` argument on each call that needs it; `packager.loadDefault` — the
> built-in packagers load automatically when a session opens), and the `host.*` operations below are
> not part of the C ABI at all — TCP, file dialogs, and file I/O are Tauri commands
> (`src-tauri/src/host.rs`), reached over Tauri's own IPC, not over `bufferx_invoke`.
>
> For the **real, authoritative operation list**, see **Appendix A** at the end of this file — it is
> generated directly from the handler registration table in `core/abi/bufferx_abi.cpp` and is kept in
> sync with it. For exact request/response shapes, read the `op*` handler function for that op in the
> same file, or the request/response pairs asserted in `core/abi/tests/AbiTest.cpp`.
>
> Everything below this notice — the envelope shape, the error code enum, the general design
> rules, and the secrets-handling rules — **is** still accurate: those held up through implementation
> and are exactly what shipped. It is specifically the per-op names and the `host.*` / `engine.*`
> stateful-session sections in the catalogue below that drifted.

Status: **historical design spec** (see notice above for what still applies). This document was
originally written as the single source of truth for the boundary between the BufferX frontend
(TypeScript / React) and the BufferX engine (C++ `BufferXCore`), intended to be implemented verbatim
on both sides.

- **Contract version:** `1` (the real wire field is numeric: `{"v": 1, ...}` — there is no separate
  string ABI identifier in the shipped code)
- **Supersedes:** the Qt `Backend` Q_INVOKABLE surface (`src/Backend.h` / `src/Backend.cpp`), which is
  deleted. Every op below carries a `Source:` line naming the Qt method it derives from so the
  migration is mechanically checkable.

---

## 0. Design rules

1. **One contract, two transports.** The engine exposes exactly one entry point: a versioned JSON
   request/response C ABI. It is served by (a) a WebAssembly module running in-process in the browser
   and inside the Tauri webview, and (b) native Tauri IPC → Rust → C ABI → `BufferXCore`. The
   request and response bytes are byte-identical across transports for every non-`host.*` op.
2. **No hidden state.** Engine state lives in an explicit session object (§5). The two pieces of
   state that exist — the loaded packager registry and the legacy-engine flag — are named,
   inspectable and resettable.
3. **Banking-grade secrecy.** PINs, PIN blocks, symmetric keys, PVKs and PEM private keys are
   **sensitive**. Sensitive values MUST NOT be logged, persisted, cached, placed in URLs, put in
   error messages, or included in telemetry — on either side of the boundary. Args carrying
   sensitive material are marked **🔒** in the catalogue. See §8.
4. **Fidelity over tidiness.** Where the legacy implementation pinned an exact literal (error text,
   golden hex, enum spelling) that literal is preserved. Where this document deliberately changes a
   name or a shape, it carries an explicit **MAPPING** note. There are no silent renames.
5. **Every response `data` is a JSON object.** Never a bare scalar, never `null`. Ops with nothing to
   return respond `{"ok":true,"data":{}}`.

---

## 1. Envelope

### 1.1 Request

```json
{ "v": 1, "op": "iso.decode", "args": { "packager": "SLM", "payload": "0200...", "inputHex": true } }
```

| Key    | Type     | Required | Rule |
|--------|----------|----------|------|
| `v`    | `1`      | yes      | Integer literal. Contract major version. Mismatch → `UNSUPPORTED_VERSION`. |
| `op`   | `string` | yes      | An op name from §3. Unknown → `UNKNOWN_OP`. Case-sensitive. |
| `args` | `object` | yes      | Op-specific. `{}` for no-arg ops. Must be a JSON object; `null`/array/scalar → `BAD_REQUEST`. |

Rules:

- The request MUST be a single UTF-8 JSON **object**. Malformed JSON, a non-object root, a missing
  `op`, or a missing/`null` `args` → `BAD_REQUEST`.
- **Unknown keys inside `args` are rejected** with `BAD_ARG` (`detail.arg` names the offending key).
  This is deliberate: a misspelled `keyHex` or `pan` must never silently fall back to a default in a
  banking tool. Forward compatibility is achieved by version negotiation (§7), not by leniency.
- Unknown keys at the **envelope** level (siblings of `v`/`op`/`args`) are ignored, reserved for
  transport metadata.
- Absent optional args take their documented default. `null` is never a valid value for a
  documented arg; send the key or omit it.

### 1.2 Response

Success:

```json
{ "ok": true, "data": { "...": "op-specific" } }
```

Failure:

```json
{ "ok": false, "error": { "code": "BAD_HEX", "message": "Invalid hex character.", "detail": { "arg": "payload" } } }
```

| Key             | Type      | Required | Rule |
|-----------------|-----------|----------|------|
| `ok`            | `boolean` | yes      | Discriminant. |
| `data`          | `object`  | when `ok:true` | Op-specific object. Never `null`. |
| `error`         | `object`  | when `ok:false` | See below. |
| `error.code`    | `string`  | yes      | A member of the `ErrorCode` enum (§2). Stable, machine-readable, never localized. |
| `error.message` | `string`  | yes      | Human-readable, English, one sentence. **Where the core produces an error string, `message` is that string verbatim** (the test suite pins several of them). Never contains sensitive material. |
| `error.detail`  | `object`  | no       | Structured extras. Reserved keys in §2.2. Open for additive keys. |

The response is always a JSON object and always carries `ok`. There is no case in which the engine
returns a bare scalar, an empty string, or a non-JSON payload. If the engine cannot even allocate a
response, `bufferx_invoke` returns `NULL` and the caller synthesizes
`{"ok":false,"error":{"code":"INTERNAL","message":"Engine returned no response."}}`.

> **MAPPING — envelope.** The legacy backend used a flat `{"ok":true, ...siblings}` /
> `{"ok":false,"error":"text"}` shape, and seven methods (`setLegacyEngineMode`, `legacyEngineMode`,
> `defaultPackagerPath`, `utf8ToHex`, `choosePackagerFile`, `chooseBufferOpenFile`,
> `chooseBufferSaveFile`) returned bare `void`/`bool`/`string` with no envelope at all. In v1 every
> op returns the envelope, method-specific keys move under `data`, and `error` becomes an object
> with a machine-readable `code`. The legacy error *text* survives as `error.message`.

---

## 2. Error codes

### 2.1 Enum

Exactly these 25 values. The enum is closed for v1; adding a member is a **minor** contract change
(§7) and clients MUST treat an unrecognized code as `INTERNAL`.

| Code | Meaning |
|------|---------|
| `BAD_REQUEST` | Envelope malformed: not JSON, root not an object, `op` missing, `args` not an object. |
| `UNSUPPORTED_VERSION` | `v` is not a contract version this engine serves. |
| `UNKNOWN_OP` | `op` is not in this engine's op list. |
| `BAD_ARG` | A required arg is missing, has the wrong JSON type, is out of range, or an unknown arg key was supplied. |
| `BAD_HEX` | A hex-text arg failed to parse. `message` is verbatim `"Invalid hex character."` or `"Odd number of hex digits."` |
| `BAD_LENGTH` | A byte/digit length constraint was violated: key length, PIN block size, header size, XOR operand mismatch, oversized RSA payload. |
| `BAD_FORMAT` | A stringly-typed enum arg (format / algorithm / padding / digest / mode / framing / operation) was not recognized. |
| `BAD_JSON` | A JSON-in-a-string arg failed to parse or was not the required shape (`fields` array, buffer document). |
| `BAD_XML` | An XML arg failed to parse or violated the required element/attribute shape. |
| `BAD_BASE64` | A Base64 arg failed to decode. |
| `UNKNOWN_PACKAGER` | The named packager is not in the session registry. `message` verbatim `"Packager not found: <name>"`. |
| `DECODE_FAILED` | ISO 8583 decode failed. Carries positional diagnostics in `detail`. |
| `ENCODE_FAILED` | ISO 8583 encode failed (`"Input error: ..."` / `"Packager definition error: ..."`). |
| `CRYPTO_FAILED` | Symmetric or RSA operation failed (cipher init, padding, PEM read, EVP error). |
| `MAC_FAILED` | MAC calculation failed. |
| `PIN_FAILED` | PIN block create/decode/translate/verify failed on PIN-domain rules. |
| `TLV_FAILED` | TLV parse/encode failed (includes exceptions thrown by `tlvtool::parse`). |
| `ENCODING_FAILED` | A text codec could not represent the input (IranSystem, ASCII, ANSI/CP_ACP, EBCDIC). |
| `RANDOM_FAILED` | The CSPRNG failed. `message` verbatim `"Secure random generation failed."` / `"Secure ISO-1 filler generation failed."` |
| `UNSUPPORTED` | The operation exists in the contract but is not compiled into / available in this build (e.g. ANSI and EBCDIC outside Windows). |
| `HOST_ONLY` | The op requires the native host transport and the current transport is WASM/web. |
| `IO_FAILED` | Filesystem read/write/open/flush failure. |
| `NETWORK_FAILED` | TCP connect/write/read failure, or a framing violation in the peer's response. |
| `TIMEOUT` | The operation exceeded its time budget. |
| `INTERNAL` | Unclassified engine fault, allocation failure, or an unexpected exception. Always possible. |

**Universal errors.** Every op may return `BAD_REQUEST`, `UNSUPPORTED_VERSION`, `UNKNOWN_OP`,
`BAD_ARG` and `INTERNAL`. The per-op `Errors:` lines in §3 list only the *additional* codes.

### 2.2 `error.detail` reserved keys

All optional. Additive keys are permitted; clients ignore what they do not know.

| Key | Type | Used by |
|-----|------|---------|
| `arg` | `string` | Which arg was rejected (`BAD_ARG`, `BAD_HEX`, `BAD_LENGTH`, `BAD_FORMAT`, `BAD_BASE64`). |
| `expected` | `string` | Human-readable expectation, e.g. `"8, 16, 24 or 32 bytes"`. |
| `received` | `string \| number` | The offending value **only when non-sensitive** — never a key, PIN or PEM. Lengths are fine. |
| `allowed` | `string[]` | The accepted literal set, for `BAD_FORMAT`. |
| `packager` | `string` | Packager name, for `UNKNOWN_PACKAGER` / codec errors. |
| `fieldId` | `number` | ISO 8583 field id implicated in an encode/decode/MAC failure. |
| `offset` | `number` | Byte offset of a decode failure. |
| `remaining` | `number` | Bytes left at the failure point. |
| `context` | `string` | Compact uppercase hex snippet around the decode failure. |
| `platform` | `string` | For `UNSUPPORTED`/`HOST_ONLY`: `"windows" \| "macos" \| "linux" \| "web"`. |
| `requiresCapability` | `string` | For `HOST_ONLY`/`UNSUPPORTED`: the `sys.capabilities` feature flag that would have permitted the op, e.g. `"tcp"`, `"ansiCodePage"`. |

The legacy ISO-8583 decode diagnostic string (`"... Length header ... offset 0 ... remaining 8 bytes
... context 3030313030323030"`) is preserved verbatim in `message`; `detail.offset`,
`detail.remaining` and `detail.context` are the parsed projection of it.

---

## 3. Op catalogue

**54 ops** across 13 namespaces.

Conventions used in the tables:

- `HexCompact` — uppercase hex, **no separators** (`"0A1BFF"`). Produced by `::toHex(bytes, true)`.
- `HexSpaced` — uppercase hex, **single-space separated** (`"0A 1B FF"`). Produced by
  `tlvtool::toHex(bytes, ' ')`. **Only the `tlv.*` ops use this.** The split is preserved from the
  legacy engine because the test suite pins both renderings; it is surfaced in the TypeScript types
  as two distinct aliases so it cannot be confused at a call site.
- Hex **input** parsing is uniform everywhere: whitespace is skipped, both cases accepted, failures
  are `BAD_HEX` with message `"Invalid hex character."` or `"Odd number of hex digits."`
- **🔒** marks a sensitive arg or response key (§8).
- **HOST** marks a host-only op (§6).

---

### 3.1 `sys.*` — capability negotiation (1 op)

#### `sys.capabilities`
Source: *new*. Called by the frontend once at startup, before any other op.

Args: none — `{}`.

Data:

| Key | Type | Notes |
|-----|------|-------|
| `contractVersion` | `1` | The `v` this engine serves. |
| `supportedVersions` | `number[]` | All contract majors accepted, ascending. v1 engines return `[1]`. |
| `engineVersion` | `string` | Semver of the engine build, e.g. `"2.0.0"`. |
| `abi` | `string` | `"bufferx-abi-1"`. |
| `transport` | `"wasm" \| "native"` | How this engine instance is reached. |
| `platform` | `"windows" \| "macos" \| "linux" \| "web"` | |
| `features` | `Features` | See below. |
| `ops` | `string[]` | Every op name this engine will accept, sorted. **Authoritative.** An op absent from this array MUST be hidden or disabled in the UI and MUST NOT be invoked. |

`Features`:

| Key | Type | True when |
|-----|------|-----------|
| `tcp` | `boolean` | `host.tcpSend` is available (native only). |
| `fileDialogs` | `boolean` | `host.chooseOpenFile` / `host.chooseSaveFile` are available. |
| `fileSystem` | `boolean` | `host.readTextFile` / `host.writeTextFile` are available. |
| `ansiCodePage` | `boolean` | The four `host.*Ansi*` ops work (Windows only). |
| `ansiCodePageId` | `number \| null` | `GetACP()` when `ansiCodePage`, else `null`. `1256` is the Persian ANSI page the legacy tests guard on. |
| `ebcdic` | `boolean` | `tools.run` accepts `ASCII-TO-EBCDIC` / `EBCDIC-TO-ASCII` (Windows only). |
| `csprng` | `boolean` | A cryptographically secure RNG is wired up. Must be `true` for `pin.create` ISO-1/ISO-3, `pin.translateAtm` with an ISO-1 destination, and `tools.run` `RANDOM-KEY`. |

Errors: universal only.

> **Transport rule.** A session uses exactly **one** transport for its whole lifetime. On desktop
> everything routes to native; on web everything routes to WASM. The two engines hold independent
> registries and legacy-mode flags, so mixing them within a session would silently desynchronize
> packager state. The frontend router MUST NOT fall back per-op.

---

### 3.2 `engine.*` — session state (3 ops)

#### `engine.setLegacyMode`
Source: `setLegacyEngineMode` (`Backend.h:19`).

| Arg | Type | Req | Notes |
|-----|------|-----|-------|
| `enabled` | `boolean` | yes | |

Data: `{ "legacyEngine": boolean }` — the resulting state.

Side effects: sets the session's legacy flag, read implicitly by `iso.decode`, `iso.encode`,
`mac.calculate`, `mac.verify`. Defaults to `false` on a fresh session.

> **MAPPING.** Legacy returned `void`. v1 echoes the resulting state so the client can reconcile
> without a follow-up read.

Errors: universal only.

#### `engine.getLegacyMode`
Source: `legacyEngineMode` (`Backend.cpp:284`).

Args: none. Data: `{ "legacyEngine": boolean }`.

> **MAPPING.** Legacy returned a bare `bool`.

Errors: universal only.

#### `engine.reset`
Source: *new*.

Args: none. Data: `{ "legacyEngine": false, "packagers": [] }`.

Clears the packager registry and sets `legacyEngine=false`, returning the session to its
freshly-created state. Required because the WASM transport uses the process default session (§5.3)
and cannot destroy/recreate it.

Errors: universal only.

---

### 3.3 `packager.*` — packager registry (4 ops)

#### `packager.loadDefault`
Source: `defaultPackagerPath` + `loadPackagerFile("")` (`Backend.cpp:288-290`, `328-351`).

Args: none.

Data: `{ "packagers": string[], "source": "builtin" }` — `packagers` is the `Packager.name` list in
load order.

**REPLACES the entire registry.**

> **MAPPING.** The legacy pair returned the Qt resource path `":/data/packagers.xml"` and then read
> it from the Qt resource system. Qt is gone. In v1 the engine **embeds `data/packagers.xml` at
> build time** and this op loads it; there is no path to hand out. `defaultPackagerPath` has no v1
> successor and is removed. The embedded document must parse to exactly **32** packagers — the test
> suite pins that count.

Errors: `BAD_XML`, `INTERNAL`.

#### `packager.loadXml`
Source: `loadPackagerFile` (`Backend.cpp:328-351`), reshaped for the sandbox.

| Arg | Type | Req | Notes |
|-----|------|-----|-------|
| `xml` | `string` | yes | The complete packager XML document text. Empty/whitespace-only → `BAD_ARG`. |

Data: `{ "packagers": string[], "source": "xml" }`.

**REPLACES the entire registry** (`state.packagers = loadResult.packagers`). Every packager-aware op
(`packager.fields`, `iso.decode`, `iso.encode`, `mac.calculate`, `mac.verify`) resolves its
`packager` arg by exact, case-sensitive `std::string` match against this registry.

> **MAPPING.** The legacy op took a filesystem *path* and read the file itself, which is impossible
> in a browser. v1 takes the XML **text**. On desktop the frontend composes
> `host.chooseOpenFile` → `host.readTextFile` → `packager.loadXml`; on web it composes an
> `<input type="file">` read → `packager.loadXml`. The legacy error
> `"Failed to open packager file: <path>"` therefore moves to `host.readTextFile` as `IO_FAILED`.
> `PackagerLoadResult.error` is preserved verbatim (substring-pinned by tests:
> `"missing required attribute 'Name'"`, `"invalid integer value for attribute 'FieldId'"`,
> `"XML parse error"`).

Errors: `BAD_XML`.

#### `packager.list`
Source: *new* (was only obtainable as a side effect of loading).

Args: none. Data: `{ "packagers": string[], "source": "builtin" | "xml" | "none" }`.

Errors: universal only.

#### `packager.fields`
Source: `packagerFieldsJson` (`Backend.cpp:353-397`).

| Arg | Type | Req | Notes |
|-----|------|-----|-------|
| `packager` | `string` | yes | Exact, case-sensitive registry name. |

Data:

| Key | Type | Notes |
|-----|------|-------|
| `name` | `string` | |
| `lenLen` | `number` | |
| `lenFormat` | `string` | |
| `fieldCount` | `number` | |
| `macMethod` | `string` | e.g. `"FULL"`, `"PARTIAL"`. |
| `macSize` | `number` | |
| `macConfigured` | `boolean` | `macSize > 0`. |
| `macSupported` | `boolean` | Identical to `macConfigured`. Both retained — the legacy test suite asserts both keys. |
| `macAutoEncodeSupported` | `false` | Hardcoded literal `false`. |
| `macFieldIds` | `number[]` | Ids where `macSize>0` **and** `isMacFieldDescriptor(def)`: `id==64 \|\| id==96 \|\| id==128 \|\|` uppercased description contains `"AUTHENTICATION CODE"` `\|\|` contains `"MAC"` (`Backend.cpp:91-97`). |
| `fields` | `PackagerFieldDef[]` | Sorted ascending by `id`. |

`PackagerFieldDef` = `{ id: number; desc: string; type: FieldTypeName; length: number; variable: boolean; lengthDigits: number }`. All six keys always present.

`FieldTypeName` is exactly one of: `"Numeric"`, `"Char"`, `"Amount"`, `"Binary"`,
`"Bitmap"`, `"LLNUM"`, `"LLLNUM"`, `"LLCHAR"`, `"LLLCHAR"`, `"LLLLCHAR"`, `"LLLLLCHAR"`,
`"LLLLLLCHAR"`, `"L7CHAR"`, `"Unknown"` (`fieldTypeToString`, `Packager.cpp:85-120`). `"Binary"`
covers `BinaryFixed`/`BinaryLl`/`BinaryLll`/`BinaryLlll` — the wire type name is lossy and cannot be
used to reconstruct the length-prefix width; use `lengthDigits`.

Errors: `UNKNOWN_PACKAGER`.

---

### 3.4 `text.*` — portable text and hex codecs (10 ops)

All ten are pure and WASM-safe. The four ANSI/CP_ACP codecs are **not** here — they are host-only
(§3.13).

#### `text.utf8ToHex`
Source: `utf8ToHex` (`Backend.cpp:420-428`).

Args: `{ text: string }`. Data: `{ rawHex: HexCompact, length: number }` (`length` = UTF-8 byte count).

> **MAPPING.** Legacy returned a bare uppercase hex string with no envelope. `length` is additive.

Errors: universal only.

#### `text.hexToUtf8`
Source: `hexToUtf8` (`Backend.cpp:430-444`).

Args: `{ hex: string }`. Data: `{ text: string, rawHex: HexCompact, length: number }`.

> **MAPPING.** Arg renamed `hexText` → `hex`. `rawHex`/`length` are additive (normalized echo of the
> parsed bytes).

Errors: `BAD_HEX`.

#### `text.iranSystemToUnicode`
Source: `iranSystemToUnicode` (`Backend.cpp:446-464`).

| Arg | Type | Req | Notes |
|-----|------|-----|-------|
| `payload` | `string` | yes | |
| `inputHex` | `boolean` | yes | `true` → parse `payload` as hex; `false` → use its UTF-8 bytes. |

Data: `{ text: string, rawHex: HexCompact, length: number }` — `rawHex`/`length` describe the **input**
bytes.

Errors: `BAD_HEX`, `ENCODING_FAILED`.

#### `text.unicodeToIranSystem`
Source: `unicodeToIranSystem` (`Backend.cpp:466-478`).

Args: `{ text: string, convertNumbers: boolean }`.

Data: `{ text: string, rawHex: HexCompact, length: number }` where **`text` is the echo of the input**
and `rawHex`/`length` describe the **produced** IranSystem bytes.

> ⚠ **Trap preserved.** `text` is *not* the converted value; the converted value is only available as
> `rawHex`. This is legacy behaviour and is retained deliberately. The same convention applies to
> `text.unicodeToAtmIranSystem` and `host.utf8ToAnsiHex`.

Errors: `ENCODING_FAILED`.

#### `text.iranSystemTextToUtf8`
Source: `iranSystemTextToUtf8` (`Backend.cpp:480-492`).

Args: `{ text: string }`. Data: `{ text: string, length: number, rawHex: HexCompact }`
(`length` = converted byte count).

Errors: `ENCODING_FAILED`.

#### `text.utf8ToIranSystemText`
Source: `utf8ToIranSystemText` (`Backend.cpp:494-506`).

Args: `{ text: string, convertNumbers: boolean }`. Data: `{ text: string, length: number, rawHex: HexCompact }`.

Errors: `ENCODING_FAILED`.

#### `text.atmIranSystemToUnicode`
Source: `atmEngineIranSystemToUnicode` (`Backend.cpp:508-522`).

Args: `{ payload: string, inputHex: boolean }`.

Data: `{ text: string, rawHex: HexCompact, length: number, profile: "ATM Engine W2IS" }` — `profile`
is a constant literal.

Preserves the ATM-engine historical quirk: lam-alef decodes to a bare lam (U+0644). This is
asserted by the test suite and MUST survive any refactor.

Errors: `BAD_HEX`, `ENCODING_FAILED`.

#### `text.unicodeToAtmIranSystem`
Source: `unicodeToAtmEngineIranSystem` (`Backend.cpp:524-535`).

Args: `{ text: string, convertNumbers: boolean }`.

Data: `{ text: string, rawHex: HexCompact, length: number, profile: "ATM Engine W2IS" }`. `text` is the
input echo (see the trap note above). Golden vector: a 10-char Persian phrase with
`convertNumbers:true` → `rawHex == "FCA4F8AF9D20F4F2A8"`; `"ATM 123"` with `convertNumbers:false` →
`"41544D20313233"`.

Errors: `ENCODING_FAILED`.

#### `text.asciiToUtf8`
Source: `asciiToUtf8Text` (`Backend.cpp:537-550`).

Args: `{ text: string }`. Data: `{ text: string, length: number, rawHex: HexCompact }`.

Rejects any code point `> 0x7F` with `ENCODING_FAILED` / `"Input contains non-ASCII characters."`
`length` is the **character** count, not the byte count (they coincide for valid input).

Errors: `ENCODING_FAILED`.

#### `text.utf8ToAscii`
Source: `utf8ToAsciiText` (`Backend.cpp:552-568`).

Args: `{ text: string }`. Data: `{ text: string, length: number, rawHex: HexCompact }` (`length` = byte count).

Errors: `ENCODING_FAILED` / `"Text contains characters that cannot be represented in ASCII."`

---

### 3.5 `iso.*` — ISO 8583 codec (2 ops)

#### `iso.decode`
Source: `decodeBuffer` (`Backend.cpp:963-1036`).

| Arg | Type | Req | Notes |
|-----|------|-----|-------|
| `packager` | `string` | yes | Must be in the registry. |
| `payload` | `string` | yes | |
| `inputHex` | `boolean` | yes | `true` → hex; `false` → UTF-8 bytes. |
| `lengthHeader` | `boolean` | yes | |
| `lengthMode` | `"ascii" \| "binary" \| "auto"` | yes | **`"auto"` is valid on this op only.** It sets `autoDetectHeader` and leaves the parsed format `None`. |
| `lengthSize` | `number` | yes | Header size in bytes/digits. With `lengthMode:"auto"` and `lengthHeader:true` it MUST be `> 0`. |

Data:

| Key | Type | Notes |
|-----|------|-------|
| `fields` | `DecodedField[]` | Ascending `id` order (from `std::map<int,std::string>`). |
| `rawHex` | `HexCompact` | The **full** input bytes including the length header. |
| `headerDetected` | `boolean` | |
| `headerSize` | `number` | |
| `messageLength` | `number` | |
| `headerMode` | `"ascii" \| "binary" \| "none"` | Derived from `DecodeResult.headerFormat` — **not** echoed from the request. |

`DecodedField` = `{ id: number; value: string; desc?: string; type?: FieldTypeName }`. `desc` and
`type` are present only when the id exists in the packager definition.

⚠ **Field value convention.** `value` carries decoded bytes interpreted as UTF-8 for printable field
types, but **UPPERCASE HEX TEXT for binary types** (`BinaryFixed`/`BinaryLl`/`BinaryLll`/`BinaryLlll`).
This asymmetry is core behaviour (`field 52 == "A5AFB1F93E59A8F3"`) and is preserved. The same
convention applies to `iso.encode` input.

Layout modes: bitmap-only packagers (e.g. `TABLE71`) return the bitmap itself as **field 0**, so a
3-field bitmap-only message decodes to 4 entries.

Reads the session legacy flag into `DecodeOptions.legacyEngine`.

Errors: `UNKNOWN_PACKAGER`, `BAD_HEX`, `BAD_FORMAT` (`"Length header mode must be ascii or binary."`
when `lengthHeader` is set and the mode resolves to none), `BAD_ARG`
(`"Auto-detect requires a positive length size."`), `DECODE_FAILED`.

#### `iso.encode`
Source: `encodeBuffer` (`Backend.cpp:1038-1084`).

| Arg | Type | Req | Notes |
|-----|------|-----|-------|
| `packager` | `string` | yes | |
| `fields` | `InputField[]` | yes | A real JSON **array**, not a string. |
| `outputHex` | `boolean` | yes | Controls the `raw` key only. |
| `allowBinaryPadding` | `boolean` | yes | |
| `allowNumericSanitize` | `boolean` | yes | `true` strips non-digits and left-zero-pads numeric fields. |
| `lengthHeader` | `boolean` | yes | |
| `lengthMode` | `"ascii" \| "binary"` | yes | **`"auto"` is not accepted here** → `BAD_FORMAT`. |
| `lengthSize` | `number` | yes | |

`InputField` = `{ id: number; value: string }`.

**`InputField[]` normalization rules** (from `parseFieldsArray`, `Backend.cpp:99-128`, preserved):
entries that are not objects are silently skipped; `id < 0` or missing is silently skipped; an entry
whose `value` is the empty string is skipped **unless `id === 0`**; duplicate ids collapse
last-wins; the result is emitted in ascending id order.

Data: `{ raw: string, rawHex: HexCompact, length: number }`. `raw` is uppercase hex when
`outputHex:true`, otherwise the bytes decoded as UTF-8. `rawHex` is always hex.

> **MAPPING.** The legacy arg `fieldsJson` was a **JSON array serialized into a string**. In v1 it is
> a native JSON array named `fields`. A non-array value → `BAD_JSON` with the legacy message
> `"Invalid fields JSON."` The same change applies to `mac.calculate`, `mac.verify` and
> `buffer.serialize`.

Errors: `UNKNOWN_PACKAGER`, `BAD_JSON`, `BAD_FORMAT`, `ENCODE_FAILED`. Encode failures preserve the
two-category prefixes `"Input error: ..."` and `"Packager definition error: ..."` verbatim; the UI's
binary-length check keys on the substring `"binary length mismatch"`.

---

### 3.6 `mac.*` — ANSI X9.19 MAC (2 ops)

#### `mac.calculate`
Source: `calculateMacForFields` (`Backend.cpp:1086-1146`).

| Arg | Type | Req | Notes |
|-----|------|-----|-------|
| `packager` | `string` | yes | |
| `fields` | `InputField[]` | yes | Same normalization as `iso.encode`. |
| `macFieldId` | `number` | yes | Must be `>= 0`. **Erased from the field map before the MAC payload is built.** |
| `keyHex` 🔒 | `string` | yes | Hex key text. 32 hex chars = double-length 3DES key in the tested path. |
| `lengthHeader` | `boolean` | yes | |
| `lengthMode` | `"ascii" \| "binary"` | yes | |
| `lengthSize` | `number` | yes | |
| `padding` | `"iso9797-1" \| "iso9797-2"` | yes | |

Data: `{ fieldId: number, outputBytes: number, payloadHex: HexCompact, macHex: HexCompact }`.
`payloadHex` is the exact byte sequence fed to the MAC.

`outputBytes` selection (`macOutputBytesForField`, `Backend.cpp:138-147`): the packager's
`fields[macFieldId].length` when `> 0`; else `macSize/2` when `macSize > 0` and even; else `8`.

**Legacy PARTIAL-MAC path.** When the session legacy flag is on **and** `packager.macMethod` equals
`"PARTIAL"` case-insensitively, the payload is *not* the encoded message: it is the raw concatenation
of the values of every field whose `FieldDef.flags[0] == '1'`, in ascending field-id order
(`buildLegacyPartialMacPayload`, `Backend.cpp:194-212`). Pinned vector: `SHETAB7` →
`47617390010100100000000000000000001000`.

> **MAPPING — `padding`. This is a deliberate behaviour change.** Legacy `paddingMode` accepted the
> literals `"m2"`, `"iso9797-2"`, `"iso9797method2"` for ISO 9797-1 Method 2 and **silently fell back
> to Method 1 for every other value** — including `"m1"`, `""`, and the near-miss `"ISO9797 M2"`
> (the space was not stripped). Silently MACing with the wrong padding is unacceptable in a banking
> tool. v1 requires exactly `"iso9797-1"` or `"iso9797-2"` and rejects anything else with
> `BAD_FORMAT`. Migration: legacy `"m2"`/`"iso9797-2"`/`"iso9797method2"` → `"iso9797-2"`; every
> other legacy value → `"iso9797-1"` explicitly.

Errors: `UNKNOWN_PACKAGER`, `BAD_ARG` (`"MAC field id must be non-negative."`), `BAD_JSON`,
`BAD_FORMAT`, `BAD_HEX`, `ENCODE_FAILED`, `MAC_FAILED`.

#### `mac.verify`
Source: `verifyMacForFields` (`Backend.cpp:1148-1191`).

Args: identical to `mac.calculate`. `fields` MUST contain a non-empty value for `macFieldId`.

Data: `{ match: boolean, fieldId: number, providedMacHex: HexCompact, expectedMacHex: HexCompact, payloadHex: HexCompact }`.
Both MAC strings are trimmed and uppercased before comparison.

⚠ **A MAC mismatch is `ok:true` with `match:false`, not an error.** Only structural failures produce
an error envelope.

Errors: all of `mac.calculate`'s, plus `BAD_ARG` (`"MAC field <id> is empty."`).

---

### 3.7 `crypto.*` — symmetric crypto (1 op)

#### `crypto.transform`
Source: `transformCrypto` (`Backend.cpp:1193-1229`), `CryptoEngine::transform`.

| Arg | Type | Req | Notes |
|-----|------|-----|-------|
| `algorithm` | `CryptoAlgorithm` | yes | See below. |
| `operation` | `"encrypt" \| "decrypt"` | yes | Legacy compared `trimmed().toLower()`; v1 requires the exact literal. |
| `payload` 🔒 | `string` | yes | |
| `inputHex` | `boolean` | yes | |
| `keyHex` 🔒 | `string` | yes | |
| `ivHex` | `string` | yes | Empty string `""` for every ECB mode; a non-empty IV with ECB is an error. |
| `usePadding` | `boolean` | yes | PKCS#7 for the DES family; `EVP_CIPHER_CTX_set_padding` for AES. |

`CryptoAlgorithm` canonical literals — `"DES-ECB"`, `"DES-CBC"`, `"3DES-ECB"`, `"3DES-CBC"`,
`"AES-128-ECB"`, `"AES-128-CBC"`, `"AES-256-ECB"`, `"AES-256-CBC"`.

The engine normalizes by keeping alphanumerics and lowercasing (`Crypto.cpp:14-23`), so the legacy
aliases `desedeecb`, `desedecbc`, `tripledesecb`, `tripledescbc` and any punctuation/spacing variant
still resolve. **Clients MUST send the canonical form**; the aliases are accepted, not documented as
the interface.

Key/IV requirements: `DES-*` → 8-byte key; `3DES-*` → 24-byte key (a 16-byte key is auto-expanded to
K1|K2|K1); `AES-128-*` → 16; `AES-256-*` → 32. IV length: `0` for `*-ECB`, `8` for DES/3DES CBC, `16`
for AES CBC.

Data: `{ rawHex: HexCompact, text: string, length: number }` — `text` is the result bytes decoded as
UTF-8 (lossy for binary output; use `rawHex` as the truth).

Errors: `BAD_HEX`, `BAD_FORMAT` (`"Operation must be encrypt or decrypt."`, `"Unsupported algorithm."`),
`BAD_LENGTH` (`"Key length does not match algorithm requirements."`,
`"IV length does not match algorithm requirements."`, `"IV is not used by the selected algorithm."`,
`"Invalid padded payload length."`), `CRYPTO_FAILED` (`"Invalid PKCS#7 padding."`,
`"Failed to allocate cipher context."`, `"Failed to initialize cipher."`,
`"Failed to configure cipher padding."`).

---

### 3.8 `pin.*` — PIN blocks, verification, translation (10 ops)

**Every op in this namespace handles sensitive material.** See §8.

#### `pin.createIso0`
Source: `createIso0PinBlock` (`Backend.cpp:682-694`).

Args: `{ pin 🔒: string, pan: string }`. Data: `{ pin 🔒: string, pinBlockHex 🔒: HexCompact, length: number }` (`length` = 8).

Golden vector: `createIso0("1234", "43219876543210987") == "0412AC89ABCDEF67"`.

Errors: `PIN_FAILED`.

#### `pin.decodeIso0`
Source: `decodeIso0PinBlock` (`Backend.cpp:696-713`).

Args: `{ pinBlockHex 🔒: string, pan: string }`. Data: `{ pin 🔒, pinBlockHex 🔒, length }`.

Errors: `BAD_HEX`, `PIN_FAILED`.

#### `pin.create`
Source: `createPinBlock` (`Backend.cpp:715-742`).

| Arg | Type | Req | Notes |
|-----|------|-----|-------|
| `format` | `"ISO-0" \| "ISO-1" \| "ISO-3" \| "ISO-4"` | yes | |
| `pin` 🔒 | `string` | yes | |
| `pan` | `string` | when format is `ISO-0`/`ISO-3`/`ISO-4` | Ignored by `ISO-1`. |
| `keyHex` 🔒 | `string` | when format is `ISO-4` | AES key. Ignored by 0/1/3. |

Data: `{ format: "ISO-0"|"ISO-1"|"ISO-3"|"ISO-4", pin 🔒, pinBlockHex 🔒, encrypted: boolean, length: number }`.
`encrypted` is `true` only for `ISO-4`. `ISO-0/1/3` produce 8-byte clear blocks; `ISO-4` produces 16
bytes.

⚠ `ISO-1` and `ISO-3` use `RAND_bytes` filler and are **non-deterministic**. Requires
`features.csprng`.

> **MAPPING.** Legacy normalized `format.trimmed().toUpper().remove("ISO-").remove(' ')` and then
> matched `"0"|"1"|"3"|"4"`, so bare `"0".."4"` worked but `"ISO0"` (no hyphen) was rejected. v1
> accepts the four canonical literals only; the bare digits `"0"|"1"|"3"|"4"` remain accepted as
> aliases for migration but are not part of the documented interface.

Errors: `BAD_FORMAT` (`"Unsupported PIN block format. Use ISO-0, ISO-1, ISO-3, or ISO-4."`),
`BAD_HEX`, `BAD_LENGTH`, `PIN_FAILED`, `CRYPTO_FAILED`, `RANDOM_FAILED`.

#### `pin.decode`
Source: `decodePinBlock` (`Backend.cpp:744-774`).

Args: `{ format, pinBlockHex 🔒, pan?, keyHex? 🔒 }` — same format rules.
Data: `{ format, pin 🔒, pinBlockHex 🔒, encrypted: boolean, length: number }`.

Errors: `BAD_HEX`, `BAD_FORMAT`, `BAD_LENGTH`, `PIN_FAILED`, `CRYPTO_FAILED`.

#### `pin.encrypt`
Source: `encryptPinBlock` (`Backend.cpp:776-797`).

Args: `{ pinBlockHex 🔒: string, keyHex 🔒: string }`. Data: `{ pinBlockHex 🔒: HexCompact, length: number }`.

Algorithm is hardcoded `3des-ecb`, no IV, `usePadding=false`. Key must be 24 bytes, or 16 bytes
(auto-expanded K1|K2|K1).

Errors: `BAD_HEX`, `BAD_LENGTH`, `CRYPTO_FAILED`.

#### `pin.decrypt`
Source: `decryptPinBlock` (`Backend.cpp:799-820`).

Args: `{ encryptedPinBlockHex 🔒: string, keyHex 🔒: string }`. Data: `{ pinBlockHex 🔒: HexCompact, length: number }`.

Errors: `BAD_HEX`, `BAD_LENGTH`, `CRYPTO_FAILED`.

#### `pin.visaPvv`
Source: `calculateVisaPvv` (`Backend.cpp:822-833`).

Args: `{ pin 🔒: string, pan: string, pvki: string, pvkHex 🔒: string }` — `pvki` is a 1-character index.
Data: `{ pvv 🔒: string }` (4 digits).

> **MAPPING.** The core returns this in the overloaded `PinVerificationResult.value` field. v1 splits
> the three overloaded meanings into distinctly named response keys (`pvv`, `offset`, `status`).

Errors: `BAD_HEX`, `PIN_FAILED`, `CRYPTO_FAILED`.

#### `pin.ibm3624Offset`
Source: `calculateIbm3624Offset` (`Backend.cpp:835-847`).

Args: `{ pin 🔒: string, validationData: string, decimalizationTable: string, pvkHex 🔒: string }` —
`decimalizationTable` is a 16-character digit string.
Data: `{ offset 🔒: string, naturalPin 🔒: string }` (both 4 characters).

Errors: `BAD_HEX`, `PIN_FAILED`, `CRYPTO_FAILED`.

#### `pin.ibm3624Verify`
Source: `verifyIbm3624Pin` (`Backend.cpp:849-864`).

Args: `{ pin 🔒, offset 🔒, validationData, decimalizationTable, pvkHex 🔒 }`.
Data: `{ match: boolean, status: "VALID" | "INVALID", naturalPin 🔒: string }`.

⚠ A PIN mismatch is `ok:true` + `match:false`, **not** an error. `match === (status === "VALID")`;
both are returned because the legacy contract exposed both.

Errors: `BAD_HEX`, `PIN_FAILED`, `CRYPTO_FAILED`.

#### `pin.translateAtm`
Source: `translateAtmPinBlock` (`Backend.cpp:866-891`), `pintranslation::translate`.

| Arg | Type | Req | Notes |
|-----|------|-----|-------|
| `encryptedBlockHex` 🔒 | `string` | yes | Must decode to exactly 8 bytes. |
| `pan` | `string` | yes | 12–19 digits; only the last 12 are used for the PAN mask. |
| `sourceFormat` | `AtmPinFormat` | yes | |
| `sourceAlgorithm` | `AtmSourceAlgorithm` | yes | |
| `sourceKeyHex` 🔒 | `string` | yes | |
| `destinationFormat` | `AtmPinFormat` | yes | |
| `destinationAlgorithm` | `AtmDestinationAlgorithm` | yes | |
| `destinationKeyHex` 🔒 | `string` | yes | |

`AtmPinFormat` = `"ANSI/ISO-0" | "ISO-1"`.
`AtmSourceAlgorithm` = `"DES" | "2KEY-3DES" | "3DES" | "TRI-DES"`.
`AtmDestinationAlgorithm` = `AtmSourceAlgorithm | "TSN-DES"`.

> ⚠ **MAPPING — do not copy the old UI labels.** The core normalizer strips only `' '`, `'-'`, `'_'`
> and `'/'`; it does **not** strip parentheses. The legacy Qt combo strings
> `"ANSI / ISO-0 (ATM)"` and `"ISO-1 (ATM)"` therefore normalized to `"ansiiso0(atm)"` /
> `"iso1(atm)"` and were **rejected at runtime**. The canonical literals above are chosen so they
> normalize cleanly onto the core's accepted set (`ansi`, `iso0`, `ansiiso0`, `ansiiso0atm`, `iso1`,
> `iso1atm`; `des`, `2key3des`, `3des`, `trides`, `tsndes`). Do not invent new spellings without
> re-checking `PinTranslation.cpp` normalize().

`TSN-DES` is **destination-only**; as a source it fails with
`"ATM-engine TSN-DES has no source/decryption operation."` Key lengths: `DES` → 8 bytes;
`2KEY-3DES`/`3DES`/`TRI-DES` → exactly 16 bytes; `TSN-DES` → 16 bytes (two 8-byte keys).

Data: `{ translatedPinBlockHex 🔒: HexCompact, sourceFormat, sourceAlgorithm, destinationFormat, destinationAlgorithm, length: number }`
— the four echoes are **verbatim** copies of the request args, un-normalized.

⚠ The recovered clear PIN is **never** returned. When source and destination format nibbles differ
the clear block is rebuilt from the recovered PIN, and an `ISO-1` destination randomizes the filler
via `RAND_bytes`, making that path non-deterministic (requires `features.csprng`).

Golden vectors: `createAtmClearBlock("ANSI / ISO-0","1234",pan) == 0412B39ABCDEF678` — note this
differs from `pinblock::createIso0` on the same inputs (`0412AC89ABCDEF67`) because the PAN-mask
offset differs. The two families must never be cross-wired.

Errors: `BAD_HEX`, `BAD_FORMAT`, `BAD_LENGTH`, `PIN_FAILED`, `CRYPTO_FAILED`, `RANDOM_FAILED`.

---

### 3.9 `rsa.*` — RSA sign / verify / encrypt / decrypt (4 ops)

`RsaDigest` = `"SHA-1" | "SHA-256" | "SHA-512"`.
`RsaPadding` = `"PKCS1-V1_5" | "OAEP-SHA-1" | "OAEP-SHA-256"`.

Both normalize through `normalizeDigestName` (keep alphanumerics, lowercase), landing on the core's
accepted sets `sha1/rsasha1, sha256/rsasha256, sha512/rsasha512` and
`pkcs1/pkcs1v15, oaep/oaepsha1, oaepsha256`.

> **MAPPING.** The legacy alias `"rsasha"` (no digits) resolved to **SHA-256**; it remains accepted
> but is not documented as an interface value. Legacy `oaep` and `oaepsha1` both use SHA-1 for the
> OAEP digest *and* MGF1; `oaepsha256` uses SHA-256 for both. Legacy echoed the caller's
> `digestName` **verbatim** in the response; v1 echoes the **resolved canonical** `RsaDigest`, which
> is what a typed client can act on.

#### `rsa.sign`
Source: `signRsaShaBase64` (`Backend.cpp:893-908`).

Args: `{ payload 🔒: string, privateKeyPem 🔒: string, digest: RsaDigest }` — `payload` is signed as its
UTF-8 bytes; the PEM is read with `PEM_read_bio_PrivateKey` and no passphrase callback (encrypted
PEMs are not supported).

Data: `{ signatureBase64: string, digest: RsaDigest }`.

Errors: `BAD_FORMAT` (`"Unsupported RSA-SHA digest."`), `CRYPTO_FAILED`
(`"Failed to read private key PEM."`, `"RSA-SHA signing failed."`, `"Base64 encoding failed."`, …).

#### `rsa.verify`
Source: `verifyRsaShaBase64` (`Backend.cpp:910-927`).

Args: `{ payload: string, publicKeyPem: string, signatureBase64: string, digest: RsaDigest }` — the
public key must be a SubjectPublicKeyInfo PEM (`PEM_read_bio_PUBKEY`), **not** an X.509 certificate.
Whitespace in the signature is stripped before decode.

Data: `{ match: boolean, digest: RsaDigest }`.

⚠ A cryptographically invalid signature is `ok:true` + `match:false`. Only EVP-level faults produce
an error envelope.

Errors: `BAD_FORMAT`, `BAD_BASE64` (`"Invalid Base64 signature."`), `CRYPTO_FAILED`.

#### `rsa.encrypt`
Source: `encryptRsaBase64` (`Backend.cpp:929-944`).

Args: `{ payload 🔒: string, publicKeyPem: string, padding: RsaPadding }`.
Data: `{ ciphertextBase64: string }`.

Errors: `BAD_FORMAT` (`"Unsupported RSA encryption padding."`), `BAD_LENGTH`
(`"RSA payload is too large for the selected key and padding."`), `CRYPTO_FAILED`.

#### `rsa.decrypt`
Source: `decryptRsaBase64` (`Backend.cpp:946-961`).

Args: `{ ciphertextBase64: string, privateKeyPem 🔒: string, padding: RsaPadding }`.
Data: `{ plaintext 🔒: string, plaintextHex 🔒: HexCompact }`.

Errors: `BAD_BASE64`, `BAD_FORMAT`, `CRYPTO_FAILED`
(`"RSA decryption failed; check the key and padding mode."`).

---

### 3.10 `tlv.*` — BER-TLV (5 ops)

⚠ **All `tlv.*` hex output is `HexSpaced`** (uppercase, single-space separated) — except the `tag`
and `valueHex` **attributes inside generated XML**, which use no separator at all. This split is
preserved from the legacy engine and pinned by tests.

Shared shapes:

`TlvNode` = `{ tagHex: HexSpaced; path: string; length: number; composite: boolean }` plus, when
`composite:true`, `{ children: TlvNode[] }` and **no** value keys; when `composite:false`,
`{ valueHex: HexSpaced; valueText: string; description: string }` (`description` is `""` when
unknown).

- `length` is the value byte count for primitives, and for composites the **sum of the fully encoded
  sizes of all children**.
- `path` joins ancestor tag texts with `'/'`, where each tag text is itself rendered with `'/'` as the
  separator — so a two-byte tag renders `"9F/10"` and a nested path `"6F/84"`.
- `composite` is derived **solely** from `(tag[0] & 0x20) != 0`, never from an attribute or arg.

`TlvFlatEntry` = `{ path: string; tagHex: HexSpaced; length: number; valueHex: HexSpaced; valueText: string; description: string }`.
Flattening emits **leaf (primitive) nodes only**; composites contribute only their path prefix.
`valueText` is `tlvtool::toAsciiDebug`: printable bytes verbatim, non-printable rendered as a
backslash-`x` escape plus two uppercase hex digits.

#### `tlv.parse`
Source: `parseTlv` (`Backend.cpp:1231-1271`).

Args: `{ payload: string, inputHex: boolean }`.
Data: `{ rawHex: HexSpaced, tree: TlvNode[], flat: TlvFlatEntry[], treeText: string, inlineText: string }`.

Errors: `BAD_HEX`, `TLV_FAILED` (the `std::exception::what()` text thrown by `tlvtool::parse`; the C
shim MUST catch — this is the one core module that throws instead of returning an ok/error struct).

#### `tlv.validate`
Source: `validateTlv` (`Backend.cpp:1273-1289`).

Args: `{ payload: string, inputHex: boolean }`.
Data: `{ valid: true, nodeCount: number }` — `nodeCount` counts **flattened primitives (leaves) only**.

⚠ There is no `ok:true` + `valid:false` path. Invalid TLV always returns an error envelope. `valid`
is retained as a literal `true` for legacy shape compatibility.

Errors: `BAD_HEX`, `BAD_ARG` (`"TLV payload must not be empty."`), `TLV_FAILED`.

#### `tlv.build`
Source: `buildTlv` (`Backend.cpp:1460-1524`).

| Arg | Type | Req | Notes |
|-----|------|-----|-------|
| `tagHex` | `string` | yes | Valid hex, non-empty. |
| `payload` | `string` | yes | When `constructed:true` it MUST be hex encoding a sequence of child TLVs. Otherwise hex if `valueIsHex`, else raw UTF-8 bytes. |
| `valueIsHex` | `boolean` | yes | Consulted only when `constructed:false`. |
| `constructed` | `boolean` | yes | Selects how `payload` is **interpreted**. It does **not** set the composite bit. |

⚠ `constructed` and `composite` are independent. `Node::isComposite()` is derived purely from
`(tag[0] & 0x20)`, so `constructed:true` with a primitive tag yields children that are never encoded.
The frontend should warn on that combination.

Data: `{ rawHex: HexSpaced, tree: TlvNode[] (exactly one element), flat: TlvFlatEntry[], treeText: string, inlineText: string }`.

Length encoding: short form below `0x80`, otherwise `0x80|n` followed by `n` big-endian length bytes.

Errors: `BAD_HEX` (`"Invalid tag hex: <hexErr>"`, `"Constructed payload must be valid hex: <hexErr>"`,
`"Value must be valid hex: <hexErr>"`), `BAD_ARG` (`"Tag hex must not be empty."`), `TLV_FAILED`.

#### `tlv.toXml`
Source: `tlvToXml` (`Backend.cpp:1291-1317`).

Args: `{ payload: string, inputHex: boolean }`. Data: `{ xml: string, rawHex: HexSpaced }`.

XML shape (auto-formatted, with an XML declaration): root `<tlv>`; each node is
`<node tag="HEXNOSEP" [description="..."] [valueHex="HEXNOSEP"]>`. `tag` and `valueHex` use **no
separator**. `description` is emitted only when `describePath()` finds an entry. Composite nodes
carry nested `<node>` children and no `valueHex`; primitives carry `valueHex` and no children.

Errors: `BAD_HEX`, `BAD_ARG` (`"TLV payload must not be empty."`), `TLV_FAILED`.

#### `tlv.fromXml`
Source: `xmlToTlv` (`Backend.cpp:1319-1355`).

Args: `{ xml: string }`. Data: `{ rawHex: HexSpaced, treeText: string }`.

The document must have a `<tlv>` root whose direct children are `<node>` elements. Attributes: `tag`
(hex, required, non-empty), `valueHex` (hex, primitives only). The encoded output is **re-parsed to
validate boundaries** before returning.

Errors: `BAD_XML` (`"TLV XML must have a <tlv> root element."`, `"Unexpected TLV XML element: <name>."`,
`"TLV XML node has an empty tag."`, `"Constructed TLV tag <tag> cannot have valueHex."`,
`"Primitive TLV tag <tag> cannot contain child nodes."`, `"TLV XML must contain at least one node."`,
plus the XML reader's own message), `BAD_HEX`, `TLV_FAILED`.

---

### 3.11 `tools.*` — banking utilities (1 op)

#### `tools.run`
Source: `runBankingUtility` (`Backend.cpp:663-680`), `bankingtools::run`.

| Arg | Type | Req | Notes |
|-----|------|-----|-------|
| `operation` | `ToolOperation` | yes | 21 literals, below. |
| `input` 🔒* | `string` | yes (except `RANDOM-KEY`) | Primary operand. |
| `secondary` | `string` | per-op | Second operand / mode selector. Omit where unused. |
| `parameter` | `number` | per-op | Numeric modifier. Omit where unused. |

*`input` is sensitive when the operation is `KCV`, `ADJUST-ODD-PARITY` or `CHECK-ODD-PARITY` (it is a
key), and when a PAN is passed to `LUHN-*`.

`ToolOperation` canonical literals:

```
BCD-ENCODE-LEFT   BCD-ENCODE-RIGHT   BCD-DECODE-LEFT   BCD-DECODE-RIGHT
XOR-HEX
BASE64-ENCODE-TEXT  BASE64-ENCODE-HEX  BASE64-DECODE-TEXT  BASE64-DECODE-HEX
MD5   SHA-1   SHA-256   SHA-512
LUHN-CHECK   LUHN-GENERATE
ADJUST-ODD-PARITY   CHECK-ODD-PARITY
RANDOM-KEY   KCV
ASCII-TO-EBCDIC   EBCDIC-TO-ASCII
```

The engine normalizes by lowercasing then removing every `' '`, `'-'` and `'_'`
(`BankingTools.cpp:23-31`), so each canonical literal maps onto the core's accepted value
(`BCD-ENCODE-LEFT` → `bcdencodeleft`, `SHA-256` → `sha256`, `XOR-HEX` → `xorhex`, …). The legacy
display names (`"BCD Encode Left"`) and the bare normalized forms remain accepted; the tests call the
display names, proving normalization is part of the contract.

Per-operation arg semantics:

| Operation | `input` | `secondary` | `parameter` |
|-----------|---------|-------------|-------------|
| `BCD-ENCODE-LEFT` / `BCD-ENCODE-RIGHT` | digits | — | — |
| `BCD-DECODE-LEFT` / `BCD-DECODE-RIGHT` | hex | — | digit count; `<= 0` strips a trailing `F` nibble |
| `XOR-HEX` | hex | hex (2nd operand, required, same byte length) | — |
| `BASE64-ENCODE-TEXT` | text | — | — |
| `BASE64-ENCODE-HEX` | hex | — | — |
| `BASE64-DECODE-TEXT` / `BASE64-DECODE-HEX` | Base64 | — | — |
| `MD5` / `SHA-1` / `SHA-256` / `SHA-512` | text or hex | `"hex" \| "text"` (required) | — |
| `LUHN-CHECK` / `LUHN-GENERATE` | digits | — | — |
| `ADJUST-ODD-PARITY` / `CHECK-ODD-PARITY` | hex 🔒 | — | — |
| `RANDOM-KEY` | ignored | — | key size in bytes: exactly `8 \| 16 \| 24 \| 32` |
| `KCV` | hex 🔒 (8/16/24/32 bytes) | — | leading result bytes to return; `<= 0` → `3` |
| `ASCII-TO-EBCDIC` | ASCII text | — | — |
| `EBCDIC-TO-ASCII` | hex | — | — |

> **MAPPING — `secondary` for hashes.** Legacy treated the **exact literal `"hex"`** as "input is
> hex" and **any other value whatsoever** (including a typo, or omission) as "input is raw text".
> v1 requires exactly `"hex"` or `"text"` and rejects anything else with `BAD_ARG`, so a typo cannot
> silently hash the wrong bytes.

Data: `{ output: string, valid?: boolean }`.

`output` rendering by operation: **uppercase hex** for `BCD-ENCODE-*`, `XOR-HEX`, all hashes,
`ADJUST-ODD-PARITY`, `RANDOM-KEY`, `KCV`, `ASCII-TO-EBCDIC`; **digits** for `BCD-DECODE-*` and
`LUHN-GENERATE`; **Base64** for `BASE64-ENCODE-*`; **plain text or hex** for `BASE64-DECODE-TEXT` /
`BASE64-DECODE-HEX`; the literal `"VALID"` or `"INVALID"` for `LUHN-CHECK` and `CHECK-ODD-PARITY`.

`valid` is present **only** for `LUHN-CHECK` and `CHECK-ODD-PARITY`, and equals `output === "VALID"`.
(Additive; the string is retained because the legacy tests pin it.)

⚠ `RANDOM-KEY` is non-deterministic, consumes the CSPRNG, forces odd parity, and its `output` is a
**key** — sensitive. `KCV` derives its cipher from key length: 8 bytes → `des-ecb`, 16/24 →
`3des-ecb`, 32 → `aes-256-ecb`, over an all-zero block.

`ASCII-TO-EBCDIC` / `EBCDIC-TO-ASCII` require `features.ebcdic` (Windows code pages 20127 and 37).
Elsewhere they return `UNSUPPORTED` with `detail.requiresCapability = "ebcdic"`.

Errors: `BAD_FORMAT` (`"Unsupported banking utility operation."`), `BAD_ARG`
(`"BCD input must contain digits only."`, `"Digit count exceeds BCD data."`,
`"PAN input must contain digits only."`, `"PAN is too short."`, `"Key is empty."`), `BAD_HEX`
(`"Invalid BCD nibble."`, `"First value: <hexErr>"`, `"Second value: <hexErr>"`), `BAD_LENGTH`
(`"XOR values must have the same byte length."`, `"Key size must be 8, 16, 24, or 32 bytes."`,
`"KCV key must be 8, 16, 24, or 32 bytes."`), `BAD_BASE64` (`"Invalid Base64 length."`,
`"Invalid Base64 input."`), `CRYPTO_FAILED` (`"Unsupported hash algorithm."`,
`"Hash calculation failed."`), `RANDOM_FAILED` (`"Secure random generation failed."`),
`ENCODING_FAILED` (`"Input is not ASCII."`), `UNSUPPORTED` (`"EBCDIC code page 37 is unavailable."`).

---

### 3.12 `buffer.*` — buffer document serialization (2 ops)

The legacy `saveBufferFile` / `loadBufferFile` fused JSON shaping with filesystem IO. v1 splits them:
the **pure** shaping ops live here and run on every transport; the IO lives in `host.readTextFile` /
`host.writeTextFile`. On web the frontend pairs `buffer.serialize` with a Blob download and
`buffer.deserialize` with a `<input type="file">` read.

`BufferFileDocument`:

```
{
  version: 1,                       // integer literal
  packager: string,
  raw: string,
  rawFormat: "hex" | "text",
  lengthHeader: { enabled: boolean; auto: boolean; mode: string; size: number },
  fields?: InputField[]             // omitted when the caller supplied no valid array
}
```

⚠ `lengthHeader.mode` is stored **verbatim and unvalidated** — this is the on-disk schema pinned by
the legacy persistence test and must not be tightened, or existing saved buffers stop loading.

#### `buffer.serialize`
Source: the document-building half of `saveBufferFile` (`Backend.cpp:1535-1552`).

| Arg | Type | Req |
|-----|------|-----|
| `packager` | `string` | yes |
| `fields` | `InputField[]` | no — omitted from the document when absent or not an array |
| `raw` | `string` | yes |
| `rawIsHex` | `boolean` | yes — serialized as `rawFormat: "hex" \| "text"` |
| `autoDetect` | `boolean` | yes — `lengthHeader.auto` |
| `lengthHeader` | `boolean` | yes — `lengthHeader.enabled` |
| `lengthMode` | `string` | yes — stored verbatim |
| `lengthSize` | `number` | yes |

Data: `{ document: BufferFileDocument, text: string }` — `text` is the indented JSON rendering ready
to hand to `host.writeTextFile` or a Blob.

Errors: universal only.

#### `buffer.deserialize`
Source: the parsing half of `loadBufferFile` (`Backend.cpp:1562-1579`).

Args: `{ text: string }`. Data: `{ buffer: BufferFileDocument }`.

⚠ The document is passed through **unvalidated** beyond "parses as a JSON object", exactly as the
legacy op did. The frontend must treat every field as untrusted.

Errors: `BAD_JSON` (`"Buffer file is not valid JSON."` — also emitted when the JSON parses but the
root is not an object).

---

### 3.13 `host.*` — host-only capabilities (9 ops) **HOST**

Every op in this namespace requires the **native** transport. On the WASM/web transport they are
absent from `sys.capabilities.ops` and, if invoked anyway, return
`HOST_ONLY` with `detail.platform = "web"` and `detail.requiresCapability` set.

These are implemented as Tauri v2 Rust commands. Rust performs the OS interaction and either
forwards the remaining work to the C ABI or answers directly; the response envelope is identical in
shape to any other op.

#### `host.tcpSend` — requires `features.tcp`
Source: `sendTcpRequest` (`Backend.cpp:1357-1458`).

| Arg | Type | Req | Constraint |
|-----|------|-----|------------|
| `host` | `string` | yes | Trimmed, non-empty. |
| `port` | `number` | yes | `1..65535`. |
| `payload` 🔒 | `string` | yes | Must decode to at least 1 byte. |
| `inputHex` | `boolean` | yes | |
| `framing` | `"none" \| "ascii" \| "binary"` | yes | `none` sends the body raw; `ascii` prepends a zero-left-padded decimal length; `binary` prepends a big-endian length. |
| `headerSize` | `number` | yes when framing ≠ `"none"` | `1..8` for `ascii`; `1..4` for `binary`. Ignored for `none`. |
| `timeoutMs` | `number` | yes | `100..120000`. Overall budget for connect + write + read. |

Data: `{ elapsedMs: number, requestWireHex: HexCompact, responseWireHex: HexCompact, responseHex: HexCompact, responseText: string, responseLength: number }`.
`responseHex`/`responseLength` describe the **body only** (`response[headerSize..]`, or the whole
response when `framing:"none"`).

⚠ Raw TCP is impossible in a browser sandbox and the legacy implementation **blocked the calling
thread** for up to `timeoutMs`. In v1 the Rust command runs on a Tokio task and never blocks the
webview; the frontend sees a normal async invoke. Pinned framing vector: sending `"0200"` with a
4-digit ASCII header puts `"00040200"` on the wire (`requestWireHex == "3030303430323030"`).

Errors: `HOST_ONLY`, `BAD_ARG` (`"TCP host must not be empty."`, `"TCP port must be between 1 and
65535."`, `"TCP timeout must be between 100 and 120000 ms."`, `"TCP request payload must not be
empty."`), `BAD_HEX`, `BAD_FORMAT` (`"TCP framing must be none, ascii, or binary."`), `BAD_LENGTH`
(`"Header size must be 1-8 ASCII bytes or 1-4 binary bytes."`, `"Payload length does not fit the
ASCII header."`, `"Payload length does not fit the binary header."`), `NETWORK_FAILED`
(`"TCP connect failed: <err>"`, `"TCP write failed: <err>"`, `"Response has an invalid ASCII length
header."`, `"TCP peer returned no data."`, `"TCP response ended before the framed payload was
complete."`), `TIMEOUT` (`"TCP read failed or timed out: <err>"`).

#### `host.chooseOpenFile` — requires `features.fileDialogs`
Source: `choosePackagerFile` + `chooseBufferOpenFile` (`Backend.cpp:399-411`), unified.

| Arg | Type | Req | Notes |
|-----|------|-----|-------|
| `purpose` | `"packager" \| "buffer" \| "key"` | yes | Selects the dialog title and filters. |

| `purpose` | Title | Filter |
|-----------|-------|--------|
| `packager` | `Select packager XML` | `Packager XML (*.xml);;All files (*)` |
| `buffer` | `Import buffer` | `Buffer JSON (*.json);;All files (*)` |
| `key` | `Select key file` | `Key files (*.pem *.key *.txt);;All files (*)` |

Data: `{ cancelled: boolean, path: string \| null }`.

> **MAPPING.** Legacy returned a bare string and signalled cancellation with `""`. v1 returns an
> explicit `cancelled` flag; cancellation is **not** an error. `purpose:"key"` is new and serves the
> host-only key-file loading capability.

Errors: `HOST_ONLY`, `IO_FAILED`.

#### `host.chooseSaveFile` — requires `features.fileDialogs`
Source: `chooseBufferSaveFile` (`Backend.cpp:413-418`).

Args: `{ purpose: "packager" | "buffer" | "key" }` (title `Save buffer` for `buffer`).
Data: `{ cancelled: boolean, path: string | null }`.

Errors: `HOST_ONLY`, `IO_FAILED`.

#### `host.readTextFile` — requires `features.fileSystem`
Source: the IO half of `loadPackagerFile` / `loadBufferFile`.

Args: `{ path: string, purpose?: "packager" | "buffer" | "key" | "other" }`.
Data: `{ path: string, text: string, bytes: number }`.

⚠ When `purpose:"key"` the returned `text` is 🔒 sensitive: it MUST NOT be written to any log, state
snapshot, or persisted store, and the frontend must hold it only for the duration of the operation
that consumes it.

Errors: `HOST_ONLY`, `IO_FAILED` (`"Failed to open packager file: <path>"`,
`"Failed to open buffer file: <path>"`).

#### `host.writeTextFile` — requires `features.fileSystem`
Source: the IO half of `saveBufferFile` (`Backend.cpp:1526-1560`).

Args: `{ path: string, text: string }`. Data: `{ path: string, bytes: number }`.

> **BUG FIX.** The legacy op reported `ok:true` as soon as the file **opened**, so a failed or partial
> write was invisible. v1 MUST write, flush, close, and check every step, reporting `IO_FAILED` on
> any failure.

Errors: `HOST_ONLY`, `IO_FAILED` (`"Failed to save buffer to <path>"`).

#### `host.ansiToUtf8` — requires `features.ansiCodePage`
Source: `ansiToUtf8Text` (`Backend.cpp:570-591`, helpers `215-266`).

Args: `{ text: string }`. Data: `{ text: string, length: number, rawHex: HexCompact }` (`length` = ANSI
byte count; `rawHex` = hex of the CP_ACP bytes).

⚠ Output depends on the host's system ANSI code page (`CP_ACP`) and is therefore **not portable**.
Round-trips UTF-8 → CP_ACP → UTF-8 and normalizes Arabic to Persian letters:
U+064A → U+06CC, U+0649 → U+06CC, U+0643 → U+06A9.

Errors: `HOST_ONLY`, `UNSUPPORTED` (`"ANSI conversion is only available on Windows builds."`),
`ENCODING_FAILED` (`"Failed to encode text as ANSI."`, `"Failed to decode ANSI text."`).

#### `host.utf8ToAnsi` — requires `features.ansiCodePage`
Source: `utf8ToAnsiText` (`Backend.cpp:593-614`).

Args: `{ text: string }`. Data: `{ text: string, length: number, rawHex: HexCompact }` — `text` is the
CP_ACP bytes decoded back for display.

Errors: as `host.ansiToUtf8`.

#### `host.ansiHexToUtf8` — requires `features.ansiCodePage`
Source: `ansiHexToUtf8Text` (`Backend.cpp:616-639`).

Args: `{ hex: string }`. Data: `{ text: string, length: number, rawHex: HexCompact }`.

Errors: `HOST_ONLY`, `BAD_HEX`, `UNSUPPORTED`, `ENCODING_FAILED`.

#### `host.utf8ToAnsiHex` — requires `features.ansiCodePage`
Source: `utf8ToAnsiHex` (`Backend.cpp:641-661`).

Args: `{ text: string }`. Data: `{ text: string, rawHex: HexCompact, length: number }`.

> **MAPPING.** The legacy shape was `{ text: <the hex>, rawHex: <the same hex>, length, preview: <input
> echo> }` — the only method in the whole backend with a `preview` key, and the only one where `text`
> carried hex. v1 normalizes onto the house convention: **`text` is the input echo, `rawHex` is the
> hex**, and `preview` is removed. Legacy `preview` → v1 `text`; legacy `text` → v1 `rawHex`.

Errors: `HOST_ONLY`, `UNSUPPORTED`, `ENCODING_FAILED`.

---

## 4. TypeScript definitions

Complete and copy-pasteable. File: `src/engine/contract.ts`.

```ts
/* ------------------------------------------------------------------------- *
 * BufferX Engine Contract v1 — generated boundary types.
 * This file is normative. Do not hand-edit without updating
 * docs/ENGINE_CONTRACT.md in the same commit.
 * ------------------------------------------------------------------------- */

export const CONTRACT_VERSION = 1 as const;
export const ABI_ID = "bufferx-abi-1" as const;

/* --------------------------------- scalars -------------------------------- */

/** Uppercase hex, no separators: "0A1BFF". Every non-TLV op. */
export type HexCompact = string;
/** Uppercase hex, single-space separated: "0A 1B FF". tlv.* ops only. */
export type HexSpaced = string;
/** Standard Base64 text. */
export type Base64 = string;
/** PEM text, including the BEGIN/END armour. */
export type Pem = string;
/** Args object for an op that takes none. */
export type EmptyArgs = Record<string, never>;

/* --------------------------------- errors --------------------------------- */

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNSUPPORTED_VERSION"
  | "UNKNOWN_OP"
  | "BAD_ARG"
  | "BAD_HEX"
  | "BAD_LENGTH"
  | "BAD_FORMAT"
  | "BAD_JSON"
  | "BAD_XML"
  | "BAD_BASE64"
  | "UNKNOWN_PACKAGER"
  | "DECODE_FAILED"
  | "ENCODE_FAILED"
  | "CRYPTO_FAILED"
  | "MAC_FAILED"
  | "PIN_FAILED"
  | "TLV_FAILED"
  | "ENCODING_FAILED"
  | "RANDOM_FAILED"
  | "UNSUPPORTED"
  | "HOST_ONLY"
  | "IO_FAILED"
  | "NETWORK_FAILED"
  | "TIMEOUT"
  | "INTERNAL";

export const ERROR_CODES: readonly ErrorCode[] = [
  "BAD_REQUEST", "UNSUPPORTED_VERSION", "UNKNOWN_OP", "BAD_ARG", "BAD_HEX",
  "BAD_LENGTH", "BAD_FORMAT", "BAD_JSON", "BAD_XML", "BAD_BASE64",
  "UNKNOWN_PACKAGER", "DECODE_FAILED", "ENCODE_FAILED", "CRYPTO_FAILED",
  "MAC_FAILED", "PIN_FAILED", "TLV_FAILED", "ENCODING_FAILED", "RANDOM_FAILED",
  "UNSUPPORTED", "HOST_ONLY", "IO_FAILED", "NETWORK_FAILED", "TIMEOUT",
  "INTERNAL",
] as const;

export interface ErrorDetail {
  arg?: string;
  expected?: string;
  received?: string | number;
  allowed?: string[];
  packager?: string;
  fieldId?: number;
  offset?: number;
  remaining?: number;
  context?: string;
  platform?: Platform;
  requiresCapability?: keyof Features;
  [key: string]: unknown;
}

export interface EngineError {
  code: ErrorCode;
  message: string;
  detail?: ErrorDetail;
}

/* -------------------------------- envelope -------------------------------- */

export interface EngineRequest<O extends OpName = OpName> {
  v: typeof CONTRACT_VERSION;
  op: O;
  args: OpMap[O]["args"];
}

export type EngineResponse<D> =
  | { ok: true; data: D }
  | { ok: false; error: EngineError };

export type ResponseFor<O extends OpName> = EngineResponse<OpMap[O]["data"]>;

export type Transport = "wasm" | "native";
export type Platform = "windows" | "macos" | "linux" | "web";

/* ------------------------------ shared shapes ----------------------------- */

export type FieldTypeName =
  | "Numeric" | "Char" | "Amount" | "Binary" | "Bitmap"
  | "LLNUM" | "LLLNUM" | "LLCHAR" | "LLLCHAR" | "LLLLCHAR"
  | "LLLLLCHAR" | "LLLLLLCHAR" | "L7CHAR" | "Unknown";

/** Field value carries UTF-8 text for printable types and UPPERCASE HEX for binary types. */
export interface InputField { id: number; value: string }

export interface DecodedField {
  id: number;
  value: string;
  desc?: string;
  type?: FieldTypeName;
}

export interface PackagerFieldDef {
  id: number;
  desc: string;
  type: FieldTypeName;
  length: number;
  variable: boolean;
  lengthDigits: number;
}

export type LengthMode = "ascii" | "binary";
export type DecodeLengthMode = LengthMode | "auto";
export type HeaderMode = LengthMode | "none";

export interface TlvNodeBase { tagHex: HexSpaced; path: string; length: number }
export interface TlvComposite extends TlvNodeBase { composite: true; children: TlvNode[] }
export interface TlvPrimitive extends TlvNodeBase {
  composite: false;
  valueHex: HexSpaced;
  valueText: string;
  description: string;
}
export type TlvNode = TlvComposite | TlvPrimitive;

export interface TlvFlatEntry {
  path: string;
  tagHex: HexSpaced;
  length: number;
  valueHex: HexSpaced;
  valueText: string;
  description: string;
}

export interface BufferFileDocument {
  version: 1;
  packager: string;
  raw: string;
  rawFormat: "hex" | "text";
  lengthHeader: { enabled: boolean; auto: boolean; mode: string; size: number };
  fields?: InputField[];
}

/* --------------------------------- sys.* ---------------------------------- */

export interface Features {
  tcp: boolean;
  fileDialogs: boolean;
  fileSystem: boolean;
  ansiCodePage: boolean;
  ansiCodePageId: number | null;
  ebcdic: boolean;
  csprng: boolean;
}

export interface CapabilitiesData {
  contractVersion: 1;
  supportedVersions: number[];
  engineVersion: string;
  abi: string;
  transport: Transport;
  platform: Platform;
  features: Features;
  ops: OpName[];
}

/* -------------------------------- engine.* -------------------------------- */

export interface SetLegacyModeArgs { enabled: boolean }
export interface LegacyModeData { legacyEngine: boolean }
export interface EngineResetData { legacyEngine: false; packagers: [] }

/* ------------------------------- packager.* ------------------------------- */

export type PackagerSource = "builtin" | "xml" | "none";
export interface PackagerLoadData { packagers: string[]; source: PackagerSource }
export interface PackagerLoadXmlArgs { xml: string }
export interface PackagerFieldsArgs { packager: string }
export interface PackagerFieldsData {
  name: string;
  lenLen: number;
  lenFormat: string;
  fieldCount: number;
  macMethod: string;
  macSize: number;
  macConfigured: boolean;
  macSupported: boolean;
  /** Hardcoded false. */
  macAutoEncodeSupported: false;
  macFieldIds: number[];
  fields: PackagerFieldDef[];
}

/* --------------------------------- text.* --------------------------------- */

export interface TextArg { text: string }
export interface HexArg { hex: string }
export interface PayloadHexArgs { payload: string; inputHex: boolean }
export interface TextConvertArgs { text: string; convertNumbers: boolean }

export interface Utf8ToHexData { rawHex: HexCompact; length: number }
export interface TextHexData { text: string; rawHex: HexCompact; length: number }
export interface AtmTextHexData extends TextHexData { profile: "ATM Engine W2IS" }

/* --------------------------------- iso.* ---------------------------------- */

export interface IsoDecodeArgs {
  packager: string;
  payload: string;
  inputHex: boolean;
  lengthHeader: boolean;
  lengthMode: DecodeLengthMode;
  lengthSize: number;
}

export interface IsoDecodeData {
  fields: DecodedField[];
  rawHex: HexCompact;
  headerDetected: boolean;
  headerSize: number;
  messageLength: number;
  headerMode: HeaderMode;
}

export interface IsoEncodeArgs {
  packager: string;
  fields: InputField[];
  outputHex: boolean;
  allowBinaryPadding: boolean;
  allowNumericSanitize: boolean;
  lengthHeader: boolean;
  lengthMode: LengthMode;
  lengthSize: number;
}

export interface IsoEncodeData { raw: string; rawHex: HexCompact; length: number }

/* --------------------------------- mac.* ---------------------------------- */

export type MacPadding = "iso9797-1" | "iso9797-2";

export interface MacArgs {
  packager: string;
  fields: InputField[];
  macFieldId: number;
  /** SENSITIVE */
  keyHex: string;
  lengthHeader: boolean;
  lengthMode: LengthMode;
  lengthSize: number;
  padding: MacPadding;
}

export interface MacCalculateData {
  fieldId: number;
  outputBytes: number;
  payloadHex: HexCompact;
  macHex: HexCompact;
}

export interface MacVerifyData {
  match: boolean;
  fieldId: number;
  providedMacHex: HexCompact;
  expectedMacHex: HexCompact;
  payloadHex: HexCompact;
}

/* -------------------------------- crypto.* -------------------------------- */

export type CryptoAlgorithm =
  | "DES-ECB" | "DES-CBC"
  | "3DES-ECB" | "3DES-CBC"
  | "AES-128-ECB" | "AES-128-CBC"
  | "AES-256-ECB" | "AES-256-CBC";

export interface CryptoTransformArgs {
  algorithm: CryptoAlgorithm;
  operation: "encrypt" | "decrypt";
  /** SENSITIVE */
  payload: string;
  inputHex: boolean;
  /** SENSITIVE */
  keyHex: string;
  /** "" for every ECB mode. */
  ivHex: string;
  usePadding: boolean;
}

export interface CryptoTransformData { rawHex: HexCompact; text: string; length: number }

/* ---------------------------------- pin.* --------------------------------- */

export type PinBlockFormat = "ISO-0" | "ISO-1" | "ISO-3" | "ISO-4";
export type AtmPinFormat = "ANSI/ISO-0" | "ISO-1";
export type AtmSourceAlgorithm = "DES" | "2KEY-3DES" | "3DES" | "TRI-DES";
export type AtmDestinationAlgorithm = AtmSourceAlgorithm | "TSN-DES";

export interface PinIso0CreateArgs { pin: string; pan: string }
export interface PinIso0DecodeArgs { pinBlockHex: string; pan: string }
export interface PinIso0Data { pin: string; pinBlockHex: HexCompact; length: number }

export interface PinCreateArgs {
  format: PinBlockFormat;
  /** SENSITIVE */
  pin: string;
  pan?: string;
  /** SENSITIVE. ISO-4 only. */
  keyHex?: string;
}

export interface PinDecodeArgs {
  format: PinBlockFormat;
  /** SENSITIVE */
  pinBlockHex: string;
  pan?: string;
  /** SENSITIVE. ISO-4 only. */
  keyHex?: string;
}

export interface PinBlockData {
  format: PinBlockFormat;
  /** SENSITIVE */
  pin: string;
  /** SENSITIVE */
  pinBlockHex: HexCompact;
  encrypted: boolean;
  length: number;
}

export interface PinEncryptArgs { pinBlockHex: string; keyHex: string }
export interface PinDecryptArgs { encryptedPinBlockHex: string; keyHex: string }
export interface PinCipherData { pinBlockHex: HexCompact; length: number }

export interface VisaPvvArgs { pin: string; pan: string; pvki: string; pvkHex: string }
export interface VisaPvvData { pvv: string }

export interface Ibm3624OffsetArgs {
  pin: string;
  validationData: string;
  decimalizationTable: string;
  pvkHex: string;
}
export interface Ibm3624OffsetData { offset: string; naturalPin: string }

export interface Ibm3624VerifyArgs extends Ibm3624OffsetArgs { offset: string }
export interface Ibm3624VerifyData {
  match: boolean;
  status: "VALID" | "INVALID";
  naturalPin: string;
}

export interface AtmTranslateArgs {
  /** SENSITIVE. Must decode to exactly 8 bytes. */
  encryptedBlockHex: string;
  /** 12-19 digits; only the last 12 are used. */
  pan: string;
  sourceFormat: AtmPinFormat;
  sourceAlgorithm: AtmSourceAlgorithm;
  /** SENSITIVE */
  sourceKeyHex: string;
  destinationFormat: AtmPinFormat;
  destinationAlgorithm: AtmDestinationAlgorithm;
  /** SENSITIVE */
  destinationKeyHex: string;
}

export interface AtmTranslateData {
  /** SENSITIVE */
  translatedPinBlockHex: HexCompact;
  /** Verbatim, un-normalized echoes of the request args. */
  sourceFormat: string;
  sourceAlgorithm: string;
  destinationFormat: string;
  destinationAlgorithm: string;
  length: number;
}

/* ---------------------------------- rsa.* --------------------------------- */

export type RsaDigest = "SHA-1" | "SHA-256" | "SHA-512";
export type RsaPadding = "PKCS1-V1_5" | "OAEP-SHA-1" | "OAEP-SHA-256";

export interface RsaSignArgs {
  /** SENSITIVE */
  payload: string;
  /** SENSITIVE */
  privateKeyPem: Pem;
  digest: RsaDigest;
}
export interface RsaSignData { signatureBase64: Base64; digest: RsaDigest }

export interface RsaVerifyArgs {
  payload: string;
  /** SubjectPublicKeyInfo PEM, not an X.509 certificate. */
  publicKeyPem: Pem;
  signatureBase64: Base64;
  digest: RsaDigest;
}
export interface RsaVerifyData { match: boolean; digest: RsaDigest }

export interface RsaEncryptArgs {
  /** SENSITIVE */
  payload: string;
  publicKeyPem: Pem;
  padding: RsaPadding;
}
export interface RsaEncryptData { ciphertextBase64: Base64 }

export interface RsaDecryptArgs {
  ciphertextBase64: Base64;
  /** SENSITIVE */
  privateKeyPem: Pem;
  padding: RsaPadding;
}
export interface RsaDecryptData {
  /** SENSITIVE */
  plaintext: string;
  /** SENSITIVE */
  plaintextHex: HexCompact;
}

/* ---------------------------------- tlv.* --------------------------------- */

export interface TlvParseData {
  rawHex: HexSpaced;
  tree: TlvNode[];
  flat: TlvFlatEntry[];
  treeText: string;
  inlineText: string;
}
export interface TlvValidateData { valid: true; nodeCount: number }

export interface TlvBuildArgs {
  tagHex: string;
  payload: string;
  /** Consulted only when constructed === false. */
  valueIsHex: boolean;
  /** Interpretation of `payload` only. Does NOT set the composite bit. */
  constructed: boolean;
}

export interface TlvToXmlData { xml: string; rawHex: HexSpaced }
export interface TlvFromXmlArgs { xml: string }
export interface TlvFromXmlData { rawHex: HexSpaced; treeText: string }

/* --------------------------------- tools.* -------------------------------- */

export type ToolBcdOperation =
  | "BCD-ENCODE-LEFT" | "BCD-ENCODE-RIGHT" | "BCD-DECODE-LEFT" | "BCD-DECODE-RIGHT";
export type ToolHashOperation = "MD5" | "SHA-1" | "SHA-256" | "SHA-512";
export type ToolBase64Operation =
  | "BASE64-ENCODE-TEXT" | "BASE64-ENCODE-HEX" | "BASE64-DECODE-TEXT" | "BASE64-DECODE-HEX";
export type ToolLuhnOperation = "LUHN-CHECK" | "LUHN-GENERATE";
export type ToolParityOperation = "ADJUST-ODD-PARITY" | "CHECK-ODD-PARITY";
export type ToolEbcdicOperation = "ASCII-TO-EBCDIC" | "EBCDIC-TO-ASCII";

export type ToolOperation =
  | ToolBcdOperation | ToolHashOperation | ToolBase64Operation
  | ToolLuhnOperation | ToolParityOperation | ToolEbcdicOperation
  | "XOR-HEX" | "RANDOM-KEY" | "KCV";

export type ToolsRunArgs =
  | { operation: ToolBcdOperation; input: string; parameter?: number }
  | { operation: "XOR-HEX"; input: string; secondary: string }
  | { operation: ToolHashOperation; input: string; secondary: "hex" | "text" }
  | { operation: ToolBase64Operation; input: string }
  | { operation: ToolLuhnOperation; input: string }
  | { operation: ToolParityOperation; input: string }
  | { operation: "RANDOM-KEY"; parameter: 8 | 16 | 24 | 32 }
  | { operation: "KCV"; input: string; parameter?: number }
  | { operation: ToolEbcdicOperation; input: string };

export interface ToolsRunData {
  output: string;
  /** Present only for LUHN-CHECK and CHECK-ODD-PARITY. */
  valid?: boolean;
}

/* -------------------------------- buffer.* -------------------------------- */

export interface BufferSerializeArgs {
  packager: string;
  fields?: InputField[];
  raw: string;
  rawIsHex: boolean;
  autoDetect: boolean;
  lengthHeader: boolean;
  /** Stored verbatim and unvalidated. */
  lengthMode: string;
  lengthSize: number;
}
export interface BufferSerializeData { document: BufferFileDocument; text: string }
export interface BufferDeserializeArgs { text: string }
export interface BufferDeserializeData { buffer: BufferFileDocument }

/* --------------------------------- host.* --------------------------------- */

export type FilePurpose = "packager" | "buffer" | "key";

export interface HostTcpSendArgs {
  host: string;
  /** 1..65535 */
  port: number;
  /** SENSITIVE */
  payload: string;
  inputHex: boolean;
  framing: "none" | "ascii" | "binary";
  /** 1..8 ascii, 1..4 binary. Ignored when framing === "none". */
  headerSize?: number;
  /** 100..120000 */
  timeoutMs: number;
}

export interface HostTcpSendData {
  elapsedMs: number;
  requestWireHex: HexCompact;
  responseWireHex: HexCompact;
  /** Body only. */
  responseHex: HexCompact;
  responseText: string;
  responseLength: number;
}

export interface HostChooseFileArgs { purpose: FilePurpose }
export interface HostChooseFileData { cancelled: boolean; path: string | null }

export interface HostReadTextFileArgs { path: string; purpose?: FilePurpose | "other" }
/** `text` is SENSITIVE when purpose === "key". */
export interface HostReadTextFileData { path: string; text: string; bytes: number }

export interface HostWriteTextFileArgs { path: string; text: string }
export interface HostWriteTextFileData { path: string; bytes: number }

/* --------------------------------- op map --------------------------------- */

export interface OpMap {
  /* sys */
  "sys.capabilities":            { args: EmptyArgs;                 data: CapabilitiesData };

  /* engine */
  "engine.setLegacyMode":        { args: SetLegacyModeArgs;         data: LegacyModeData };
  "engine.getLegacyMode":        { args: EmptyArgs;                 data: LegacyModeData };
  "engine.reset":                { args: EmptyArgs;                 data: EngineResetData };

  /* packager */
  "packager.loadDefault":        { args: EmptyArgs;                 data: PackagerLoadData };
  "packager.loadXml":            { args: PackagerLoadXmlArgs;       data: PackagerLoadData };
  "packager.list":               { args: EmptyArgs;                 data: PackagerLoadData };
  "packager.fields":             { args: PackagerFieldsArgs;        data: PackagerFieldsData };

  /* text */
  "text.utf8ToHex":              { args: TextArg;                   data: Utf8ToHexData };
  "text.hexToUtf8":              { args: HexArg;                    data: TextHexData };
  "text.iranSystemToUnicode":    { args: PayloadHexArgs;            data: TextHexData };
  "text.unicodeToIranSystem":    { args: TextConvertArgs;           data: TextHexData };
  "text.iranSystemTextToUtf8":   { args: TextArg;                   data: TextHexData };
  "text.utf8ToIranSystemText":   { args: TextConvertArgs;           data: TextHexData };
  "text.atmIranSystemToUnicode": { args: PayloadHexArgs;            data: AtmTextHexData };
  "text.unicodeToAtmIranSystem": { args: TextConvertArgs;           data: AtmTextHexData };
  "text.asciiToUtf8":            { args: TextArg;                   data: TextHexData };
  "text.utf8ToAscii":            { args: TextArg;                   data: TextHexData };

  /* iso */
  "iso.decode":                  { args: IsoDecodeArgs;             data: IsoDecodeData };
  "iso.encode":                  { args: IsoEncodeArgs;             data: IsoEncodeData };

  /* mac */
  "mac.calculate":               { args: MacArgs;                   data: MacCalculateData };
  "mac.verify":                  { args: MacArgs;                   data: MacVerifyData };

  /* crypto */
  "crypto.transform":            { args: CryptoTransformArgs;       data: CryptoTransformData };

  /* pin */
  "pin.createIso0":              { args: PinIso0CreateArgs;         data: PinIso0Data };
  "pin.decodeIso0":              { args: PinIso0DecodeArgs;         data: PinIso0Data };
  "pin.create":                  { args: PinCreateArgs;             data: PinBlockData };
  "pin.decode":                  { args: PinDecodeArgs;             data: PinBlockData };
  "pin.encrypt":                 { args: PinEncryptArgs;            data: PinCipherData };
  "pin.decrypt":                 { args: PinDecryptArgs;            data: PinCipherData };
  "pin.visaPvv":                 { args: VisaPvvArgs;               data: VisaPvvData };
  "pin.ibm3624Offset":           { args: Ibm3624OffsetArgs;         data: Ibm3624OffsetData };
  "pin.ibm3624Verify":           { args: Ibm3624VerifyArgs;         data: Ibm3624VerifyData };
  "pin.translateAtm":            { args: AtmTranslateArgs;          data: AtmTranslateData };

  /* rsa */
  "rsa.sign":                    { args: RsaSignArgs;               data: RsaSignData };
  "rsa.verify":                  { args: RsaVerifyArgs;             data: RsaVerifyData };
  "rsa.encrypt":                 { args: RsaEncryptArgs;            data: RsaEncryptData };
  "rsa.decrypt":                 { args: RsaDecryptArgs;            data: RsaDecryptData };

  /* tlv */
  "tlv.parse":                   { args: PayloadHexArgs;            data: TlvParseData };
  "tlv.validate":                { args: PayloadHexArgs;            data: TlvValidateData };
  "tlv.build":                   { args: TlvBuildArgs;              data: TlvParseData };
  "tlv.toXml":                   { args: PayloadHexArgs;            data: TlvToXmlData };
  "tlv.fromXml":                 { args: TlvFromXmlArgs;            data: TlvFromXmlData };

  /* tools */
  "tools.run":                   { args: ToolsRunArgs;              data: ToolsRunData };

  /* buffer */
  "buffer.serialize":            { args: BufferSerializeArgs;       data: BufferSerializeData };
  "buffer.deserialize":          { args: BufferDeserializeArgs;     data: BufferDeserializeData };

  /* host — native transport only */
  "host.tcpSend":                { args: HostTcpSendArgs;           data: HostTcpSendData };
  "host.chooseOpenFile":         { args: HostChooseFileArgs;        data: HostChooseFileData };
  "host.chooseSaveFile":         { args: HostChooseFileArgs;        data: HostChooseFileData };
  "host.readTextFile":           { args: HostReadTextFileArgs;      data: HostReadTextFileData };
  "host.writeTextFile":          { args: HostWriteTextFileArgs;     data: HostWriteTextFileData };
  "host.ansiToUtf8":             { args: TextArg;                   data: TextHexData };
  "host.utf8ToAnsi":             { args: TextArg;                   data: TextHexData };
  "host.ansiHexToUtf8":          { args: HexArg;                    data: TextHexData };
  "host.utf8ToAnsiHex":          { args: TextArg;                   data: TextHexData };
}

export type OpName = keyof OpMap;
export type ArgsOf<O extends OpName> = OpMap[O]["args"];
export type DataOf<O extends OpName> = OpMap[O]["data"];

/** Ops that require the native transport. */
export const HOST_ONLY_OPS = [
  "host.tcpSend", "host.chooseOpenFile", "host.chooseSaveFile",
  "host.readTextFile", "host.writeTextFile", "host.ansiToUtf8",
  "host.utf8ToAnsi", "host.ansiHexToUtf8", "host.utf8ToAnsiHex",
] as const satisfies readonly OpName[];

export type HostOnlyOp = (typeof HOST_ONLY_OPS)[number];

/** The single boundary function. Implemented once per transport. */
export type Invoke = <O extends OpName>(
  op: O,
  args: ArgsOf<O>,
) => Promise<ResponseFor<O>>;

/** Narrowing helper. */
export function isOk<D>(
  r: EngineResponse<D>,
): r is { ok: true; data: D } {
  return r.ok;
}
```

---

## 5. C ABI

Header: `engine/include/bufferx_abi.h`. Everything is `extern "C"`, C99-compatible, and free of C++
types across the boundary.

### 5.1 Signatures

```c
#ifdef __cplusplus
extern "C" {
#endif

/* Opaque engine session. Holds the packager registry and the legacy-engine flag. */
typedef struct bufferx_session bufferx_session;

/* Returns "bufferx-abi-1". Pointer to static storage; MUST NOT be freed. */
const char* bufferx_abi_version(void);

/* Returns the engine build's semver, e.g. "2.0.0". Static storage; MUST NOT be freed. */
const char* bufferx_engine_version(void);

/* Creates an independent session. Returns NULL only on allocation failure. */
bufferx_session* bufferx_session_create(void);

/* Destroys a session and zeroizes its scratch state. Passing NULL is a no-op.
 * Using the handle afterwards is undefined behaviour. */
void bufferx_session_destroy(bufferx_session* session);

/* The primary entry point.
 * request_json : borrowed, NUL-terminated UTF-8. Not retained past return.
 * returns      : heap-allocated, NUL-terminated UTF-8 response envelope, owned by the
 *                caller, released with bufferx_free(). NULL only if a response could
 *                not be allocated. */
char* bufferx_session_invoke(bufferx_session* session, const char* request_json);

/* Locked convenience form: equivalent to
 *   bufferx_session_invoke(bufferx_default_session(), request_json)
 * Same ownership rules. */
char* bufferx_invoke(const char* request_json);

/* The process-wide default session backing bufferx_invoke(). Created on first use.
 * Never returns NULL after a successful first call. Never destroyed by the engine. */
bufferx_session* bufferx_default_session(void);

/* Releases a buffer returned by bufferx_invoke / bufferx_session_invoke.
 * Passing NULL is a no-op. Double-free is undefined behaviour. */
void bufferx_free(char* response_json);

#ifdef __cplusplus
}
#endif
```

`bufferx_invoke(const char*) -> char*` and `bufferx_free(char*)` are the two symbols named in the
locked architecture decision and remain the canonical contract. The session functions are the
underlying primitive that makes state explicit; `bufferx_invoke` is defined in terms of them.

### 5.2 Memory ownership

| Object | Allocated by | Freed by | Rule |
|--------|--------------|----------|------|
| `request_json` | Caller | Caller | **Borrowed.** The engine reads it during the call and never retains a pointer to it. The caller may free or zeroize it the instant the call returns. |
| Return of `bufferx_*invoke` | Engine | **Caller, via `bufferx_free` only** | Exactly once. Never `free()`, `delete`, `delete[]`, or a Rust deallocator — the engine may be a DLL with its own heap, and crossing allocators is undefined behaviour. |
| `bufferx_session*` | `bufferx_session_create` | `bufferx_session_destroy` | Exactly once. The default session is owned by the engine and MUST NOT be destroyed by the caller. |
| Return of `bufferx_abi_version` / `bufferx_engine_version` | Engine (static) | Nobody | Never free. Valid for the process lifetime. |

Additional rules:

- A `NULL` return from an invoke is not an error envelope — it means allocation failed. The caller
  synthesizes `{"ok":false,"error":{"code":"INTERNAL","message":"Engine returned no response."}}`.
- The engine never returns an empty string and never returns non-JSON. Callers may assume the buffer
  parses as a JSON object.
- The engine never throws across the ABI. Every C++ exception — including the ones
  `tlvtool::parse` throws — is caught at the shim boundary and converted to an error envelope; an
  unknown exception becomes `INTERNAL`.
- **Rust side:** wrap the returned pointer in a guard whose `Drop` calls `bufferx_free`, so a
  `?`/panic path cannot leak. Copy to a `String` with `CStr::to_str()`, then drop the guard before
  returning.
- **WASM side:** the same rules apply through the Emscripten heap. The JS wrapper must call
  `_bufferx_free` in a `finally` block. Request strings containing sensitive material must be
  written into the heap and **explicitly zeroized** before being freed (§8).

### 5.3 Thread safety

- **A `bufferx_session` is not thread-safe.** At most one thread may be inside
  `bufferx_session_invoke` for a given session at any time. There is no internal lock.
- **Distinct sessions are fully independent** and may be invoked concurrently from different threads.
  The engine holds no shared mutable global state; the only process-wide state is one-time OpenSSL
  initialization, performed through a thread-safe one-shot.
- **The default session is process-wide**, so `bufferx_invoke` is *not* re-entrant or thread-safe.
  The Tauri Rust layer MUST serialize it — hold the session in `Mutex<SessionHandle>` in Tauri
  managed state, or (preferred) give each window its own `bufferx_session` and never touch the
  default one.
- WASM is single-threaded; the default session is the natural and correct choice there.
- Ops are otherwise pure functions of `(session state, args)`. Nothing is cached between calls.

### 5.4 Session state — and why it is explicit

A session holds exactly two things:

| State | Type | Set by | Read by | Fresh value |
|-------|------|--------|---------|-------------|
| Packager registry | ordered `std::vector<Packager>` + name index | `packager.loadDefault`, `packager.loadXml` (both **replace** it wholesale) | `packager.list`, `packager.fields`, `iso.decode`, `iso.encode`, `mac.calculate`, `mac.verify` | empty |
| Legacy engine flag | `bool` | `engine.setLegacyMode` | `iso.decode`, `iso.encode`, `mac.calculate`, `mac.verify` | `false` |

Nothing else persists. No PIN, key, PEM, payload, buffer document or MAC is retained after the
invoke that used it returns.

The legacy backend held both of these as **process globals on a Qt singleton**, which is exactly what
this design rejects:

1. **Implicit coupling.** `iso.decode` silently changed behaviour based on a flag set by an unrelated
   earlier call. With a handle, "which engine state am I decoding against" is answerable from the
   call site.
2. **Multi-window desktop.** Tauri can open several windows; each needs its own packager set and
   legacy mode. Globals make that impossible without a mutex around the whole app.
3. **Concurrency.** Native IPC is served from a thread pool. Per-session state turns a
   process-wide lock into a per-session one.
4. **Testing.** Every test can create a virgin session, so test order cannot leak state. The legacy
   suite depended on `legacyEngineMode()` defaulting off across the entire binary.
5. **Secret hygiene.** A session has a destructor. `bufferx_session_destroy` zeroizes scratch
   buffers deterministically; a global never gets destroyed at all.

The locked `bufferx_invoke(const char*)` signature is preserved by binding it to a lazily-created
default session, so the simple case (WASM, one engine, one thread) needs no handle management while
the demanding case (native, multi-window, multi-thread) has one available.

### 5.5 Core dependencies the shim must respect

- **Do not include `BufferXCore.h` in the shim.** The umbrella header pulls in `IranSystem.h`, which
  exposes `QString` in its public API and drags QtCore into the translation unit. The shim includes
  the individual module headers, and `IranSystem` must first be given a UTF-8 `std::string` facade
  (or be reimplemented Qt-free) before the core can build for WASM.
- `PackagerLoader` uses `QXmlStreamReader` in its `.cpp` only; it must be ported to a Qt-free XML
  parser for the WASM target. Its error strings are substring-pinned by tests and must survive.
- OpenSSL (`libcrypto`) is required by `Crypto`, `Mac`, `PinBlock`, `PinTranslation`,
  `PinVerification`, `RsaSha` and `BankingTools`, and must be built for the WASM target.
  `RAND_bytes` must be backed by `crypto.getRandomValues` in the browser; if it is not,
  `features.csprng` MUST report `false` and the affected ops MUST return `RANDOM_FAILED` rather than
  produce weak randomness.
- `Iso8583Codec` field values cross the ABI as `std::map<int, std::string>` where binary field types
  carry **uppercase hex text**, not raw bytes. The shim must not "fix" this.

---

## 6. Host-only ops and capability negotiation

### 6.1 The host-only set

Nine ops, all in the `host.*` namespace:

| Op | Legacy source | Why it cannot run in a browser |
|----|---------------|-------------------------------|
| `host.tcpSend` | `sendTcpRequest` | Raw outbound TCP is impossible in the browser sandbox. |
| `host.chooseOpenFile` | `choosePackagerFile`, `chooseBufferOpenFile` | Native modal file dialog. |
| `host.chooseSaveFile` | `chooseBufferSaveFile` | Native modal save dialog. |
| `host.readTextFile` | file half of `loadPackagerFile`, `loadBufferFile` | Arbitrary filesystem path read. |
| `host.writeTextFile` | file half of `saveBufferFile` | Arbitrary filesystem path write. |
| `host.ansiToUtf8` | `ansiToUtf8Text` | Win32 `MultiByteToWideChar` with `CP_ACP`. |
| `host.utf8ToAnsi` | `utf8ToAnsiText` | Win32 `CP_ACP`. |
| `host.ansiHexToUtf8` | `ansiHexToUtf8Text` | Win32 `CP_ACP`. |
| `host.utf8ToAnsiHex` | `utf8ToAnsiHex` | Win32 `CP_ACP`. |

Plus one **conditional** case that is not a whole op: `tools.run` with `operation` in
`{"ASCII-TO-EBCDIC", "EBCDIC-TO-ASCII"}` requires Windows code pages 20127/37 and returns
`UNSUPPORTED` (`detail.requiresCapability = "ebcdic"`) elsewhere. The op itself is available
everywhere.

The four ANSI ops are additionally **Windows-only within the native transport**: on macOS and Linux
the native engine reports `features.ansiCodePage = false`, omits them from `ops`, and returns
`UNSUPPORTED` / `"ANSI conversion is only available on Windows builds."` if invoked. `HOST_ONLY` is
for the wrong *transport*; `UNSUPPORTED` is for the wrong *platform or build*.

### 6.2 Graceful degradation

Each host-only op has a defined web substitute the frontend composes itself:

| Desktop flow | Web substitute |
|--------------|----------------|
| `host.chooseOpenFile` → `host.readTextFile` → `packager.loadXml` | `<input type="file">` → `File.text()` → `packager.loadXml` |
| `buffer.serialize` → `host.chooseSaveFile` → `host.writeTextFile` | `buffer.serialize` → `Blob` → download anchor |
| `host.chooseOpenFile` → `host.readTextFile` → `buffer.deserialize` | `<input type="file">` → `File.text()` → `buffer.deserialize` |
| `host.chooseOpenFile{purpose:"key"}` → `host.readTextFile` | paste into the key field; never persisted |
| `host.tcpSend` | **no substitute.** The Host Tester panel is hidden on web. |
| `host.ansi*` | **no substitute.** The ANSI codec tab is hidden when `features.ansiCodePage` is false. |

### 6.3 The startup handshake

```
1. Frontend selects a transport: native if the Tauri IPC bridge is present, else WASM.
2. Frontend invokes  { v: 1, op: "sys.capabilities", args: {} }  on that transport.
3. Frontend stores contractVersion, features and the ops array in the Zustand engine store.
4. Every UI surface gated on a host capability reads it from that store — never from
   navigator/userAgent sniffing, never from a try/catch around a speculative invoke.
5. An op absent from `ops` is disabled with a tooltip naming the missing capability.
   Invoking it anyway is a frontend bug; the engine will answer HOST_ONLY or UNSUPPORTED.
6. If contractVersion is not 1, the app refuses to proceed and shows a version-mismatch
   screen rather than degrading. Mismatched enum literals in a banking tool are worse
   than an outage.
```

`sys.capabilities` is the **only** op that may be invoked before the frontend knows what the engine
supports. It never fails except for universal envelope errors, and it is available on every
transport.

---

## 7. Versioning and compatibility

### 7.1 What `v` means

`v` is the **contract major version** and nothing else. It changes only for breaking changes.
`sys.capabilities.engineVersion` carries the engine build's own semver and moves independently.

### 7.2 Change classification

**Minor (no `v` bump; old clients keep working):**

- Adding a new op.
- Adding a new **optional** arg with a documented default that reproduces the previous behaviour.
- Adding a new key to a response `data` object.
- Adding a new `ErrorCode` member. Clients MUST treat an unrecognized code as `INTERNAL`.
- Adding a key to `error.detail` or to `features`.
- Adding a new accepted **alias** for an existing stringly-typed enum value.
- Widening a numeric range.

**Breaking (requires a `v` bump):**

- Removing or renaming an op, an arg, or a response key.
- Changing an arg's type, or making an optional arg required.
- Removing or renaming an enum literal (`ErrorCode`, `PinBlockFormat`, `ToolOperation`,
  `CryptoAlgorithm`, `MacPadding`, `RsaDigest`, `RsaPadding`, `FieldTypeName`, `HeaderMode`, …).
- Changing a hex rendering (`HexCompact` ↔ `HexSpaced`) on any existing key.
- Changing the *meaning* of an existing value — including which `ErrorCode` an existing failure maps
  to, or which core routine an op dispatches to.
- Narrowing a numeric range, or tightening validation so previously accepted input is rejected.
- Changing the `BufferFileDocument` on-disk schema.

### 7.3 Engine obligations

- An engine advertises every major it serves in `supportedVersions`. It MUST serve the current major
  and SHOULD serve the immediately previous one for one release cycle.
- A request whose `v` is not in `supportedVersions` → `UNSUPPORTED_VERSION`, with
  `detail.expected` listing the supported majors. The engine MUST NOT guess.
- `ops` in `sys.capabilities` is authoritative and MUST list exactly what this build accepts.
- `bufferx_abi_version()` changes only when the **C symbol surface** changes — adding an op does not
  change it; adding or removing an exported function does.

### 7.4 Client obligations

- Send `v: 1` explicitly on every request. Never omit it, never infer it.
- Check `contractVersion` at startup and refuse to run on a mismatch (§6.3 step 6).
- Handle unknown `ErrorCode` values as `INTERNAL`.
- Never depend on JSON key **order**. The legacy backend emitted keys alphabetically because of
  `QJsonDocument::Compact` (`"error"` before `"ok"`); v1 makes no ordering guarantee at all.
- Never parse `error.message` to decide control flow. Branch on `error.code`, and on
  `error.detail` where a structured field exists. `message` is for humans and may be reworded in a
  minor release.

### 7.5 Frozen behaviours

These are pinned by the existing test suite and are breaking changes to touch, regardless of how
cosmetic they look:

- Hex parse errors: `"Odd number of hex digits."`, `"Invalid hex character."`
- Packager loader errors containing `"missing required attribute 'Name'"`,
  `"invalid integer value for attribute 'FieldId'"`, `"XML parse error"`.
- The bundled packager document parsing to exactly **32** packagers.
- ISO 8583 encode prefixes `"Input error: "` and `"Packager definition error: "`, and the decode
  diagnostic format carrying `"Length header"`, `"offset N"`, `"remaining N bytes"`, `"context <hex>"`.
- Binary ISO 8583 field values being uppercase hex text in `fields[].value`.
- Bitmap-only packagers exposing the bitmap as field `0`.
- Golden vectors: `pinblock::createIso0("1234","43219876543210987") == "0412AC89ABCDEF67"`;
  `pintranslation::createAtmClearBlock("ANSI / ISO-0","1234",pan) == "0412B39ABCDEF678"`;
  ISO-1 with filler `5` == `"1412B33016745CD2"`; ANSI X9.19 MAC == `"205FCEC8BADE9527"`;
  the INFOTECH legacy-engine wire
  `02007020000000000000161234567890123456400000000000001000123456`; the SHETAB7 PARTIAL-MAC payload
  `47617390010100100000000000000000001000`; `unicodeToAtmIranSystem` →
  `"FCA4F8AF9D20F4F2A8"`; KCV of `0123456789ABCDEF` (3 bytes) == `"D5D44F"`; Luhn
  `7992739871` → `79927398713`.
- The ATM-engine lam-alef quirk decoding to a bare lam (U+0644).
- `HexSpaced` for `tlv.*` output; no separator inside generated TLV XML attributes.
- `tools.run` accepting the legacy display names (`"BCD Encode Left"`, `"SHA-256"`) via
  normalization.
- `macAutoEncodeSupported` being the literal `false`.

### 7.6 Untested surface — change with extra care

The legacy suite does **not** cover these, so a regression will not be caught automatically. Add
tests before touching them: all AES and all CBC paths in `crypto.transform`; `padding:"iso9797-2"`
and MAC truncation lengths other than 8; the four non-ATM IranSystem entry points (no byte-level
assertions); `tools.run` `SHA-1`/`SHA-256`/`SHA-512`/`RANDOM-KEY`/`BASE64-*-HEX`; `rsa.*` with
`SHA-1`/`SHA-512` and the `match:false` path; `tlvtool::toAsciiDebug`, `describePath`, `Node::encode`
and `parse()`'s throwing behaviour on malformed input; `fieldTypeToString`; negative PIN
verification; and nearly every validation path in the crypto, PIN and RSA modules.

---

## 8. Sensitive material

BufferX is a banking tool. The following are **secrets** wherever they appear, in args or in
response data:

PINs (`pin`, `naturalPin`), PIN blocks (`pinBlockHex`, `encryptedBlockHex`,
`translatedPinBlockHex`), PVVs and offsets (`pvv`, `offset`), symmetric keys (`keyHex`,
`sourceKeyHex`, `destinationKeyHex`, `pvkHex`), private keys (`privateKeyPem`), RSA plaintext
(`plaintext`, `plaintextHex`, `payload` on `rsa.sign`/`rsa.encrypt`), `crypto.transform`'s `payload`,
`host.tcpSend`'s `payload`, `tools.run`'s `input` and `output` for `RANDOM-KEY`/`KCV`/`*-ODD-PARITY`,
and any file text read with `purpose:"key"`.

Rules — binding on both sides of the boundary:

1. **Never logged.** No `console.log`, no `tracing::info!`, no request/response dumps, no
   redux/zustand devtools serialization, no crash reporter payload, no telemetry.
2. **Never persisted.** Not in `localStorage`, `sessionStorage`, IndexedDB, cookies, Tauri store,
   command history, or the `BufferFileDocument`.
3. **Never in a URL.** No query string, no fragment, no route param, no deep link.
4. **Never in an error.** `error.message` and `error.detail.received` MUST NOT echo a secret. Report
   lengths and shapes instead (`detail.expected: "16 bytes"`, `detail.received: 12`).
5. **Zeroized after use.** The engine scrubs its scratch buffers; `bufferx_session_destroy` scrubs
   the session. The Rust and JS wrappers overwrite the request buffer holding a secret before
   releasing it.
6. **Masked by default in the UI.** Key and PIN inputs render masked with an explicit reveal, and
   reveal state is never persisted.
7. **Not in the command palette history.** Ctrl+K recent-command entries store the op name and
   non-sensitive args only.

---

## Appendix A — As-built operation index

Generated from the handler registration table in `core/abi/bufferx_abi.cpp` (the `handlers()`
function). This is the real, complete op catalogue — 42 operations across 10 namespaces — kept in
sync with the source rather than maintained by hand as prose. Every op takes the standard
envelope (`{v, op, args}` in, `{ok, data}` / `{ok:false, error}` out) described in §1 above.

Argument and result-key lists here were extracted from the handler bodies; where a function is
genuinely bespoke (its arguments come from a shared struct, not individual reads), the table
says so instead of guessing. For the exact shape of any op, the single source of truth is the
`op*` function it maps to in `bufferx_abi.cpp`, or the matching case in `AbiTest.cpp`.

### `engine.*` — session and capability probing (2 ops)

| Op | Args | Result / notes |
|---|---|---|
| `engine.version` | {} | version, protocol |
| `engine.capabilities` | {} | tcp, files, keyFiles, desktop (native Tauri host overrides these; the WASM build answers all false) |

### `packager.*` — the packager registry (3 ops)

| Op | Args | Result / notes |
|---|---|---|
| `packager.loadXml` | xml | packagers, count — replaces the whole registry, does not merge |
| `packager.list` | {} | packagers |
| `packager.fields` | packager | fields |

### `iso.*` — the ISO 8583 codec (2 ops)

| Op | Args | Result / notes |
|---|---|---|
| `iso.decode` | packager, payload, inputHex, header{enabled,mode,size}, autoDetect, legacyEngine | fields[], headerDetected, headerFormat, headerSize, messageLength, byteLength |
| `iso.encode` | packager, fields[], outputHex, header, allowBinaryPadding, allowNumericSanitize, legacyEngine | hex, text, byteLength |

### `mac.*` — ANSI X9.19 MAC (2 ops)

| Op | Args | Result / notes |
|---|---|---|
| `mac.calculate` | packager, fields, macFieldId, keyHex, header, paddingMode, legacyEngine | macHex |
| `mac.verify` | same as mac.calculate | valid, expectedHex, actualHex |

### `crypto.*` — symmetric crypto (1 op)

| Op | Args | Result / notes |
|---|---|---|
| `crypto.transform` | algorithm, operation ("encrypt"|"decrypt"), payload, inputHex, keyHex, ivHex, usePadding | hex, text, byteLength |

### `pin.*` — PIN blocks, verification, translation (8 ops)

| Op | Args | Result / notes |
|---|---|---|
| `pin.create` | format ("iso0"|"iso1"|"iso3"|"iso4"), pin, pan, keyHex | hex, pin |
| `pin.decode` | format, blockHex, pan, keyHex | pin |
| `pin.encrypt` | blockHex, keyHex | hex |
| `pin.decrypt` | blockHex, keyHex | hex |
| `pin.visaPvv` | pin, pan, pvki, pvkHex | pvv |
| `pin.ibm3624Offset` | pin, validationData, decimalizationTable, pvkHex | offset |
| `pin.verifyIbm3624` | pin, offset, validationData, decimalizationTable, pvkHex | valid, naturalPin |
| `pin.translateAtm` | blockHex, pan, sourceFormat, sourceAlgorithm, sourceKeyHex, destinationFormat, destinationAlgorithm, destinationKeyHex | translatedHex, clearHex, pin |

### `rsa.*` — RSA sign/verify/encrypt/decrypt (4 ops)

| Op | Args | Result / notes |
|---|---|---|
| `rsa.sign` | payload, privateKeyPem, digest ("sha1"|"sha256"|"sha512") | signature |
| `rsa.verify` | payload, publicKeyPem, signature, digest | valid |
| `rsa.encrypt` | payload, publicKeyPem, padding ("oaep"|"oaepsha1"|"oaepsha256"|"pkcs1"|"pkcs1v15") | ciphertext |
| `rsa.decrypt` | ciphertext, privateKeyPem, padding | plaintext |

### `tlv.*` — BER-TLV (5 ops)

| Op | Args | Result / notes |
|---|---|---|
| `tlv.parse` | payload, inputHex | nodes[], tree, flat[], inline |
| `tlv.build` | tagHex, payload, valueIsHex, constructed | hex |
| `tlv.validate` | payload, inputHex | valid, message, nodeCount |
| `tlv.toXml` | payload, inputHex | xml |
| `tlv.fromXml` | xml | hex |

### `ltv.*` — fixed-width Length–Tag–Value (2 ops)

Both operations accept `lengthBytes` (1–4, default 2), `tagBytes` (1–4, default 1),
`littleEndian` (default false), and `lengthIncludesHeader` (default false). Tags are opaque bytes;
records are sequential and do not imply nesting. Header-inclusive lengths count L + T + V.

| Op | Args | Result / notes |
|---|---|---|
| `ltv.parse` | payload, inputHex, width/order options above | nodes (tag, length in value bytes, value, ascii, composite=false, children=[], byte offset) |
| `ltv.build` | tagHex, payload, valueIsHex (default true), width/order options above | hex; one record |

### `tools.*` — the banking toolbox (1 op)

| Op | Args | Result / notes |
|---|---|---|
| `tools.run` | operation, input, secondary, parameter | output — see BankingTools.cpp for the full operation enum (BCD, XOR, Base64, hashes, Luhn, parity, random keys, KCV, EBCDIC 037) |

### `text.*` — portable text, hex, and IranSystem codecs (12 ops)

| Op | Args | Result / notes |
|---|---|---|
| `text.utf8ToHex` | text | hex |
| `text.hexToUtf8` | hex | text |
| `text.iranSystemToUnicode` | payload, inputHex | text |
| `text.unicodeToIranSystem` | text, convertNumbers | hex, text |
| `text.iranSystemTextToUtf8` | text | text |
| `text.utf8ToIranSystemText` | text, convertNumbers | text, hex |
| `text.atmEngineIranSystemToUnicode` | payload, inputHex | text |
| `text.unicodeToAtmEngineIranSystem` | text, convertNumbers | hex, text |
| `text.ansiToUtf8` | text | text — "ansi" here means Windows-1256, not the OS ANSI code page |
| `text.utf8ToAnsi` | text | text |
| `text.ansiHexToUtf8` | hex | text |
| `text.utf8ToAnsiHex` | text | hex |

**Host-only, not ABI ops.** `tcp_send`, `read_text_file`, `write_text_file`, `list_buffer_files`, and `default_buffer_directory`
are Tauri commands (`src-tauri/src/host.rs`), invoked over Tauri IPC directly — not through
`bufferx_invoke`. The frontend calls `hostCapabilities()` to learn whether the current host (native
Tauri vs. WASM-in-browser) exposes them before offering the affected UI.
