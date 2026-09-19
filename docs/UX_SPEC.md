# BufferX UX Specification

Rewrite target: TypeScript + React 19 + Vite + Tailwind v4 + Radix primitives + Zustand + CodeMirror 6, shipped as a Tauri v2 desktop shell and as an identical static web build.

This document defines the information architecture, the interaction model, and the per-surface layout for the replacement UI. It is written against the complete inventory of the Qt/QML application being deleted. Every control and every dropdown option in that inventory has a defined home here; Appendix A is the audit table that proves it.

**Status:** pre-implementation design spec, not a live reference. Where this document constrains the engine contract (`bufferx_invoke`), those constraints held and are accurate (see `docs/ENGINE_CONTRACT.md`'s own as-built appendix for the real op names). Two frontend details below are known to have drifted from what shipped: the rail defaults to **labeled** at every window size now, not icon-only below 1600px — an icon-only default with twelve unlabelled destinations turned out to cost more than the space it saved, and a persisted-preference bug meant the setting could get stuck even after the default changed (fixed by a settings-store migration; see `app/src/store/settings.ts`). And persistence ended up simpler than described: both hosts use plain `localStorage` (the Tauri webview supports it natively), allowlisted per-key by `app/src/store/persist.ts` rather than by a separate lint rule — see that file's own header comment for the real mechanism, which is stricter than what is described here (a name-pattern denylist is enforced at three separate points: compile time, store construction, and every write).

---

## 0. Design tenets

These are the decision rules. When two designs are defensible, the one that satisfies more tenets wins.

1. **The buffer is the document. Everything else is a tool applied to it.** The workspace is never occluded by a tool. An operator must be able to read the field table and use MAC/PIN/TLV simultaneously — the single most damaging property of the old UI was `closeToolPanels()`.
2. **Density over comfort.** Default row height 28px, 12px/13px UI type, 13px monospace for data. A 1440x900 window must show at least 22 field rows plus the raw buffer plus an open tool.
3. **Nothing changes under the operator without a visible trace.** Every mutation that was previously silent (encoding conversion, packager switch wiping fields, delete triggering re-encode, `Decrypt` overwriting payload, TLV-to-XML rewriting the input) is either removed, made explicit, or made undoable with a visible history entry.
4. **Errors are data, not interruptions.** Errors appear inline at their origin and accumulate in a durable, timestamped, copyable Problems log. Modals are reserved for nothing in v1 — even the two encode-recovery dialogs become inline resolution cards.
5. **Provenance on every result.** Any computed value states what produced it (algorithm, profile, key length, padding, byte scope) and goes stale visibly when its inputs change.
6. **Secrets are memory-only.** PINs, PANs in secret contexts, symmetric keys, PVKs, and PEM private keys are never persisted, never logged, never serialized into URLs, never included in diagnostics, and never written to a buffer file. This is a hard rule, enforced by an allowlist-based persistence layer (Section 5.5).
7. **The keyboard is the primary input device.** Every action reachable by mouse is reachable by keyboard, and the ten most common workflows are completable without touching the mouse.
8. **Web parity by subtraction, never by silence.** Features that need host powers are visibly gated with a stated reason and a working alternative, not hidden.

---

## 1. Information architecture

### 1.1 The chosen model

**Persistent left rail (destinations) + tabbed document workspace (buffers) + dockable tool column (tools) + collapsible Problems drawer + thin status strip.**

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ COMMAND BAR                                                                       36px  │
│ ▣ BufferX │ ◆auth-req.bxb* │ reversal.bxb │ + │   [SLM ▾] [ENGINE: GENERIC] [WASM] ⌘K ⚙ │
├──────┬────────────────────────────────────────────────────────┬─────────────────────────┤
│      │ WORKSPACE                                              │ TOOL DOCK               │
│ RAIL │ ┌────────────────────────────────────────────────────┐ │ ┌─────────────────────┐ │
│ 52px │ │ RAW PANE            [Text│Hex│Bytes] [⤢] [copy]    │ │ │ MAC            ⌄ ⤢ ✕│ │
│ /    │ │ ── structure ribbon ──────────────────────────────  │ │ ├─────────────────────┤ │
│ 208  │ │ 3031 3230 F23C 4491 0EE0 8200 0000 0000 …          │ │ │ …tool body…         │ │
│      │ │                                                    │ │ ├─────────────────────┤ │
│ Buf  │ │ Framing: [auto ▾][ASCII│Binary][4 ⇅] [+ Add length]│ │ │ PIN            ⌄ ⤢ ✕│ │
│ TLV  │ ├──────────── splitter (drag / Alt+Shift+↑↓) ────────┤ │ │ …collapsed…         │ │
│ Iran │ │ FIELDS   [filter ⌕] [present only] [cols ▾] [+ Add]│ │ └─────────────────────┘ │
│ MAC  │ │ ┌────┬─────────────┬───────┬──────┬──────────────┐ │ │                         │
│ PIN  │ │ │Bit │ Name        │ Type  │ Len  │ Value        │ │ │  380–640px, resizable   │
│ Cry  │ │ ├────┼─────────────┼───────┼──────┼──────────────┤ │ │  stacked accordion      │
│ RSA  │ │ │ 2  │ PAN         │ N     │19/19 │ 6274…        │ │ │                         │
│ Tbx  │ │ │ 3  │ Proc code   │ N     │ 6/6  │ 000000       │ │ │                         │
│ Net  │ │ └────┴─────────────┴───────┴──────┴──────────────┘ │ │                         │
├──────┴────────────────────────────────────────────────────────┴─────────────────────────┤
│ PROBLEMS  2 errors · 1 warning                            [Errors│Warnings│All] [⌃`]  ⌄ │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ Fields · Ln 1 : Col 12 : Pos 12 : Sel 0   │  148 bytes · 13 fields · SLM · hdr ASCII/4  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

**Regions, precisely:**

| Region | Size | Persistence | Notes |
|---|---|---|---|
| Command bar | 36px fixed | always visible | App menu, buffer tabs, packager pill, engine pill, transport pill, palette button, settings |
| Left rail | 52px icon-only / 208px labeled | user toggles, persisted | Destinations, not commands. Groups separated by 1px dividers |
| Workspace | fills | per-tab | Hosts the Buffer document, or a promoted tool, or Settings |
| Tool dock | 380–640px, default 440px | pinned tools persisted (non-secret state only) | Right side. Vertical accordion of open tools. Can host 1–3 expanded tools |
| Problems drawer | 24px collapsed strip / 30% expanded | persisted collapsed state | Bottom, full width, above the status strip |
| Status strip | 24px fixed | always visible | Caret readout, scope, counts, framing summary |

### 1.2 Rail contents

The rail is destinations only. Twelve entries in five groups:

```
WORKSPACE
  Buffer          Alt+1   the document workspace (returns to the active buffer tab)
ANALYZE
  TLV             Alt+2
  IranSystem      Alt+3
SECURITY
  MAC             Alt+4
  PIN             Alt+5
  Crypto          Alt+6
  RSA             Alt+7
UTILITIES
  Toolbox         Alt+8   (was "Banking Tools")
  Network         Alt+9   (ISO TCP tester) — desktop-gated
─────────────── (pushed to bottom)
  History         Alt+0   undo timeline + run history
  Settings        Ctrl+,
  About           (info icon)
```

Activating a rail entry **opens or focuses that tool in the dock**; it does not replace the workspace and does not close any other tool. Activating an already-focused tool collapses it (toggle), so `Alt+4 Alt+4` is a fast peek. `Ctrl+Shift+\` promotes the focused dock tool into a full workspace tab for deep work (useful for TLV trees and the Network history).

Rail items carry a state dot when the tool holds live state: teal = has a result, amber = has a stale result, red = has an error, grey ring = holds a secret in memory. The secret ring is important — it is how an operator knows a key is still loaded.

### 1.3 Buffer tabs

Buffers are documents, replacing the old `bufferSwitcher` combobox. Tab strip lives in the command bar.

- Tab label = file basename, or `untitled-1` for unsaved.
- Dirty indicator: a filled dot before the name. Closing a dirty tab prompts (Save / Discard / Cancel) — the old behavior silently discarded edits.
- Middle-click or `Alt+W` closes; `Alt+Shift+W` reopens the last closed buffer with full state.
- `Alt+[` / `Alt+]` cycle. `Alt+N` new buffer.
- Overflow becomes a `⌄ 4 more` menu; the palette `Ctrl+K` with no prefix also lists open buffers.
- Each tab owns: raw text, encoding mode, packager selection, framing config, field model, undo stack, and its own Problems entries. Tools in the dock operate on the **active tab** and show its name in their header (`MAC · auth-req.bxb`) so there is never ambiguity about scope.

### 1.4 Why this model, against the alternatives

| Alternative | Why rejected |
|---|---|
| **Keep footer popovers, just restyle** | The fatal property is mutual exclusion. An 8583 investigation is inherently multi-tool: read F52 while the PIN tool is open, compare the MAC field against the expected MAC, watch the field table while translating a PIN block. Mutual exclusion forces the operator to memorize values between panel toggles. Also: absolute pixel positioning anchored to launcher buttons cannot survive a responsive layout. |
| **Full-screen tool pages (rail swaps the whole workspace)** | Simple and responsive, but it re-creates the exclusion problem in a nicer costume: you cannot see the field table while running the MAC. Every cross-tool flow (Load F52, Apply F52, Load Field, Apply to Field, Load Buffer) becomes a blind copy between screens. Rejected as the *default*, retained as an *option* via tool promotion (`Ctrl+Shift+\`) for tools that genuinely want space. |
| **Floating/draggable windows (MDI)** | Maximum flexibility, maximum cost: window management becomes a task, layouts are never reproducible between operators, and keyboard focus order is unspecifiable. Wireshark and Proxyman both abandoned free-floating panes for docked columns. |
| **Modal wizard flows per task** | Wrong shape entirely. These are stateless transforms an operator re-runs dozens of times with tweaks; a wizard adds ceremony to a 2-second operation. |
| **Tool palette inside a right dock, one tool at a time (single-slot dock)** | Close, and it was the runner-up. Rejected because MAC-verify and PIN-translate frequently need to be visible together with the field table, and because a stacked accordion costs nothing when only one tool is open (it looks identical to a single-slot dock). |
| **Command-palette-only, no rail** | Excellent for experts, hostile to discovery. A banking tool has a long tail of rarely used operations (EBCDIC, parity adjust, PVV) that must be browsable. The rail is the discovery surface; the palette is the speed surface. Both ship. |

**The chosen model is the only one that satisfies tenet 1 (workspace never occluded) and tenet 7 (keyboard-first) at the same time.**

### 1.5 Responsive behavior

| Width | Layout |
|---|---|
| ≥1600px | Rail labeled, workspace, dock at 480px, optional second dock column (two tools side by side) |
| 1200–1599px | Rail icon-only (labels on hover + on focus), dock at 440px, single dock column |
| 900–1199px | Dock becomes an overlay sheet over the right 440px of the workspace with a scrim-free translucent edge; `Esc` closes it. Raw/Fields split becomes adjustable but defaults to 30/70 |
| <900px | Single column. Rail collapses to a hamburger + palette. Raw and Fields become two tabs. Tools open as full-screen sheets. This is a degraded-but-usable mode, explicitly not the design target |

Minimum supported: 1024x640. Nothing is ever positioned in absolute window pixels; all panels are flex/grid children with `min-width: 0` and internal scroll.

---

## 2. The buffer workspace

This is where operators live. It is the only surface tuned for continuous use rather than task completion.

### 2.1 Paste-first flow

The empty workspace is a large drop/paste target:

```
┌───────────────────────────────────────────────────────────┐
│                                                           │
│              Paste an ISO 8583 buffer                     │
│              Ctrl+V anywhere, or drop a .bxb / .hex file  │
│                                                           │
│      [ Paste from clipboard ]  [ Open file… ]             │
│                                                           │
│      Or start from a template:                            │
│      · 0200 Purchase (SLM)   · 0800 Network mgmt (SLM)    │
│      · 0420 Reversal (SLM)   · Empty message              │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

On paste (or drop, or type-then-pause):

1. **Encoding sniff.** All characters in `[0-9A-Fa-f\s]` and even nibble count → Hex. Otherwise Text. The result is shown as a *proposal chip* on the encoding control (`Hex (detected)`), not applied silently and not reverted silently. If the operator overrides, the override sticks for that tab and the chip reads `Hex (locked)`.
2. **Framing sniff.** If `Auto-detect` is on, the engine reports `headerDetected`, `headerMode`, `headerSize`; the framing control adopts them and renders them as `auto · ASCII · 4` in muted type, with a lock icon to pin them manually.
3. **Packager resolution.** If the current packager decodes cleanly, decode and stop. If it errors, do **not** show a raw error: show a *Packager candidates* banner across the top of the fields pane.
4. **Auto-decode.** 350ms debounce after typing stops; immediate on paste/drop. Auto-decode is a toggle (`Auto` chip next to Decode), default on, persisted.

**Packager candidates banner** (replaces "guess and get an error"):

```
┌────────────────────────────────────────────────────────────────────────┐
│ SLM could not decode this buffer.  Candidates ranked by fit:           │
│  ● SHETAB7   13 fields, 0 errors, 148/148 bytes consumed   [Use]       │
│  ○ NEGIN     11 fields, 1 error,  146/148 bytes consumed   [Use]       │
│  ○ NEGINLink  9 fields, 4 errors                           [Use]       │
│  Identify again (Ctrl+Shift+D)              Dismiss and show the error │
└────────────────────────────────────────────────────────────────────────┘
```

`Identify packager` runs a decode attempt against every packager in the loaded XML and ranks by (fields decoded, bytes consumed, errors). This is a pure client-side loop over `bufferx_invoke` and is the single highest-value new feature for capture analysis.

### 2.2 Packager selection

The packager pill in the command bar (`[SLM ▾]`) opens a **searchable command-palette-style picker**, not a flat combobox. All 32 shipped entries are preserved and each row shows metadata that already exists in the XML but was never surfaced:

```
┌──────────────────────────────────────────────────────────┐
│ ⌕ tab                                                    │
├──────────────────────────────────────────────────────────┤
│ TABLE71    LenLen 4 · MAC FULL/8 · 64 fields             │
│ TABLE73    LenLen 4 · MAC FULL/8 · 64 fields             │
│ TABLE62    LenLen 4 · no MAC     · 48 fields             │
│ TABLE69    …                                             │
│ TABLE74    …                                             │
│ TABLE89    …                                             │
│ TABLE27    …                                             │
├──────────────────────────────────────────────────────────┤
│ Source: data/packagers.xml           [Browse…] [Reload]  │
└──────────────────────────────────────────────────────────┘
```

Full option list preserved and grouped for scanning (groups are presentational only; search is flat and fuzzy):

- **Hosts:** SLM, NEGIN, NEGINLink, INFOTECH, HYPERCOM, SHETAB7
- **Datasets:** DATASET, BIT121
- **Tables:** TABLE71, TABLE73, TABLE62, TABLE69, TABLE74, TABLE89, TABLE27
- **Amount/Statement:** AMNT87, AMNT2003, STMNT2003
- **STX:** STX10, STX11, STX12, STX13, STX14, STX15, STX20, STX21, STX01, STX60, STX61, STX62, STX65, STX67

Where the XML carries a `Desc` attribute (the STX entries), it is shown as the row subtitle. `Browse…` uses the native dialog on desktop and a file input / drag-drop on web (Section 5.7).

**Switching packager no longer destroys field values.** The new behavior:

1. Field values are retained and re-mapped by bit number.
2. A remap summary appears as an inline card above the table: `TABLE71 defines 61 of your 13 fields. 2 fields (F62, F121) are not defined — kept as Custom.` with `Keep custom` / `Drop them` / `Undo switch`.
3. Descriptions, types, and lengths refresh from the new `fieldDefs`.
4. MAC metadata, `LenLen`→header size, and legacy framing are applied as before, but each change is listed in the same card: `Header size 4 → 7 (LenLen)`.
5. The whole switch is a single undo entry.

`Reset` (rebuild the default set `[0,2,3,4,7,11,12,13,37,39,41,42,49]` filtered by the packager) survives as an explicit command, not as an invisible side effect.

### 2.3 Raw pane

Height: default 34% of the workspace, dragged via a splitter, `Alt+Shift+Up/Down` in 5% steps, double-click the splitter to toggle between 34% and 70%. Minimum 96px, maximum 80%. **It grows with the window** — the old 140–170px hard cap is gone.

Header row of the raw pane:

```
RAW   [Text│Hex│Bytes]   [Decode ⌃⏎] [Build ⌃⇧⏎] [Auto ✓]     [⧉ copy ▾] [⤢]
Framing  [Auto-detect ✓] [Include on build ☐] [ASCII│Binary] [size 4 ⇅] [+ Add length]
```

**Three view modes** (segmented control, `Ctrl+Shift+V` cycles):

**Text** — CodeMirror 6, editable, wraps, monospace 13px, no line numbers (a buffer is usually one line). Placeholder: `Paste or build an ISO 8583 buffer here…`.

**Hex** — CodeMirror 6 with a hex input mode: pairs are visually grouped `3031 3230 F23C 4491`, non-hex keystrokes are rejected at the input level rather than failing later, and a byte ruler runs above. Editing here edits bytes directly. Odd nibble count is shown as a trailing amber half-byte marker rather than an error.

**Bytes** — read-only classic dump with field coloring, the diagnostic view the old app entirely lacked:

```
        00 01 02 03  04 05 06 07  08 09 0A 0B  0C 0D 0E 0F   ASCII
0000    30 31 34 38  30 32 30 30  F2 3C 44 91  0E E0 82 00   0148 0200 .<D. ....
        └─ LEN ───┘  └─ MTI ───┘  └────── BITMAP ────────────
0010    00 00 00 00  31 36 36 32  37 34 31 32  33 34 35 36   .... 1662 7412 3456
        ──────────┘  └─ F2 PAN ─────────────────────────────
```

- Left gutter: 4-digit hex offset.
- 16 bytes per row, grouped in 4s, 13px monospace, `font-variant-numeric: tabular-nums`.
- ASCII gutter on the right; non-printables render as `·` at 45% opacity.
- Under each row, a 2px region ribbon segment tinted by the owning field, with a label where it starts.
- Rows virtualized; a 64KB buffer scrolls at 60fps.

**Structure ribbon** — an always-visible 18px proportional map of the whole message, sitting directly under the view-mode segmented control in all three modes:

```
│LEN│ MTI │  BITMAP  │ F2 │F3│F4  │ F7 │F11│      F35        │ F55 │F64│
```

- Segments are proportional to byte length, with a 6px minimum so 1-byte fields stay clickable.
- Colors: LEN, MTI, and BITMAP have three fixed reserved hues; data fields cycle an 8-hue palette assigned by bit number so the same field keeps the same color across decodes.
- Hover: tooltip `F35 · Track 2 Data · 37 bytes · offset 0x0051–0x0075`, and the corresponding table row highlights.
- Click: selects the field, scrolls the table to it, and selects its bytes in the Bytes view.
- Unmapped trailing bytes render as a hatched grey segment labeled `+6 unparsed` — a decode problem you can *see*.

**Field-to-byte linking (bidirectional, the core diagnostic loop):**

| Gesture | Effect |
|---|---|
| Hover a field row | Its byte range gets a 12% tinted background in Hex/Bytes and its ribbon segment brightens |
| Focus/select a field row | Byte range gets a solid 2px outline and, if `Follow` is on, scrolls into view |
| Hover a byte in Bytes view | Owning field row highlights; tooltip shows `F35 byte 12 of 37` |
| Click a byte | Selects the owning field row and focuses its value cell |
| Select a byte range | Status strip shows `Sel 12 bytes · spans F35, F37` |
| `Follow` toggle | In the raw pane header; when off, highlighting still happens but no auto-scroll |

`ENGINE REQUIREMENT:` the decode response must return, per field, `offset` and `length` in bytes of the *encoded* message (including any length-header offset), plus `regions[]` for `lengthHeader`, `mti`, `bitmap`, and `unparsed`. Without offsets there is no byte view worth building.

**Framing controls, co-located.** All message-length-header state moves out of the Settings popover and onto the raw pane, next to `+ Add length` which mutates it. This resolves the "same state edited from two disconnected places" pain point.

- `Auto-detect ✓` (default on) — passes `mode: "auto"` on decode; the response writes back the mode and size and the controls visibly animate to the detected values with a 600ms `detected` highlight.
- `Include on build ☐` (default off) — gates the header on encode.
- `ASCII│Binary` — **always enabled and always readable.** The old rule (disabled unless "Include on build" is checked, while auto-detect writes into it) produced a greyed control that changed by itself. Now it is enabled whenever either auto-detect or include-on-build is on, and when both are off it renders as a muted read-only chip rather than a dead widget.
- `size 4 ⇅` — number input 1–8, with a lock icon. Packager `LenLen` and legacy framing set it, and the lock pins the operator's manual value against those writes. A tooltip states its origin: `4 · from packager LenLen`, `2 · from Legacy ATM framing`, `7 · manual`.
- `+ Add length` — unchanged semantics (compute byte count, prefix ASCII zero-padded decimal or big-endian binary of `size` bytes, force `Include on build` on) but now shows a preview before committing: `Will prefix "0148" (4 ASCII bytes). Total 152 bytes. [Add] [Cancel]`. Refuses with an inline note when the header already matches.

**Copy menu** (`⧉ copy ▾`): Copy raw · Copy as hex · Copy as text · Copy as byte array (C) · Copy dump (with offsets and ASCII) · Copy fields as JSON. Bare click copies raw in the current view mode.

**Removed gesture:** the undiscoverable double-click-to-decode `TapHandler` is deleted. Double-click in the raw pane does what every text editor does — select a word.

### 2.4 Field table

A single full-width virtualized table. Not a two-column grid. Not a 180px fixed value column.

**Toolbar:**

```
FIELDS  ⌕ filter…   [Present only ☐] [Errors only ☐]   13 fields   [Columns ▾] [+ Add ⌥A] [⋯]
```

- `⌕ filter` (`Ctrl+F`) matches bit number, name, type, and value substring. Matches are highlighted; non-matching rows hide. `Esc` clears.
- `Present only` hides fields with empty values (useful after `Reset`).
- `Errors only` shows only rows with a validation problem.
- `Columns ▾` toggles optional columns and switches density (Compact 28px / Comfortable 34px).
- `⋯` menu: Reset to packager defaults · Clear all fields · Sort by bit (default) · Copy all as JSON · Copy all as TSV · Export fields…

**Columns:**

| # | Column | Width | Default | Content |
|---|---|---|---|---|
| 1 | severity gutter | 3px | on | Left stripe: red error, amber warning, teal info, transparent otherwise |
| 2 | `Bit` | 48px | on | `2`, right-aligned tabular monospace, with a 4px field-color swatch to its left matching the ribbon |
| 3 | `Name` | flex, min 150px, max 320px | on | Description from `fieldDefs`, or `Field <id>`, or `Custom field` for unknown. Truncates with a native tooltip |
| 4 | `Type` | 84px | on | Chip: `N` numeric, `AN`, `ANS`, `B` binary, `Z` track, `?` unknown. Full word on hover |
| 5 | `Len` | 76px | on | `19/19` actual/declared. Amber when they differ, red when the declared max is exceeded. For variable fields: `19/…99` |
| 6 | `Offset` | 96px | off | `0x0051 +37` — byte offset and length. Toggled on by operators doing wire analysis |
| 7 | `Value` | flex, fills, min 200px | on | The editor. See below |
| 8 | `Fmt` | 76px | on | Segmented `Txt│Hex` — replaces the unlabeled 28px `Hx` chip |
| 9 | actions | 64px | on | `⧉` copy, `⋯` row menu |

Header row is sticky. Column widths are drag-resizable and persisted per packager. `Bit` is the row header for screen readers (Section 6).

**Value cell.** A single-line CodeMirror 6 instance mounted lazily on focus (an unfocused row renders a plain `<span>` for scroll performance):

- 13px monospace, full remaining width — track 2 data, EMV F55 and long name fields are readable at last.
- Numeric fields get `inputMode="numeric"` and reject non-digits at input with a soft shake, rather than failing at Build time.
- Binary fields render in hex always, in 2-char groups.
- **Expand:** `Alt+Enter` or the `⤢` affordance that appears on hover at the right edge opens a **value sheet** — a 640x420 panel anchored over the dock with a multi-line editor, a hex/text toggle, byte length, a hex dump of just that field, and, for known TLV-bearing fields (48, 55, 62, and anything the packager types as TLV), an inline parsed TLV tree with `Open in TLV tool`.
- **Diagnostics as inline chips at the right edge of the cell**, each with a tooltip and a fix action:
  - `␣` teal — leading or trailing space (preserves the old `hasEdgeSpace` warning, but now visible rather than a subtle border tint). Tooltip: `Leading or trailing space. [Trim]`
  - `Ä` amber — non-ASCII content while the buffer is in Text mode. Tooltip: `Non-ASCII in text mode. [Switch buffer to Hex] [Convert field to Hex]`
  - `≠` amber — length mismatch against the packager declaration. Tooltip: `Declared 8 bytes, value is 6. [Pad with zeros] [Edit]`
  - `!` red — hard error (invalid hex, non-numeric in numeric field). Row severity stripe goes red and a Problems entry is created.
- **Field 35 transparency.** F35's `D` ⇄ `=` substitution stops being invisible. The value cell shows the *display* form (`=`), and a small `wire` chip appears in the cell; hovering shows `Wire form: …D…  Display form: …=…`, and the value sheet shows both representations stacked. The substitution rule is stated in the field's inspector line.

**Fmt column.** Segmented `Txt│Hex`, 76px, keyboard toggled with `Alt+H` on the focused row.

- Txt → Hex runs `utf8ToHex`; Hex → Txt runs `hexToUtf8` and reports `Invalid hex input.` inline on the row rather than in a global status line.
- For packager type `Binary`, the segment is **locked to Hex and labeled as such** (`Hex` with a small lock), with a tooltip `Binary fields are always shown in hex.` The old behavior — an inert control at 40% opacity that silently swallowed clicks — is replaced by an honest disabled state with a stated reason.

**Row actions.**

- `⧉` copies the value in its current representation. Long-press / dropdown: Copy value · Copy as hex · Copy as text · Copy `bit=value` · Copy row as JSON.
- `⋯` row menu: Toggle hex · Expand editor (`Alt+Enter`) · Clear value · **Remove field** (`Delete`) · Send to TLV · Send to IranSystem · Send to Crypto · Use as MAC field · Use as PIN block (F52-style, works on any field) · Show bytes in raw.
- **Removing a field no longer triggers an encode.** The row disappears, an undo entry is pushed, and the raw buffer is marked stale (Section 2.6). This kills the worst side effect in the old app.

**Adding a field.** The modal `Add field` dialog is deleted. Two replacements:

1. A permanent **add row** pinned to the bottom of the table: `+ Add field  [bit ⌕]`. Typing filters the packager's `fieldDefs` live, showing `55 · ICC Data · Binary`, so an operator can search by *name* (`type "track"` → `35 · Track 2 Data`) — the old dialog offered nothing but a raw number even though `fieldDefs` was already loaded.
2. Palette prefix `#` (`Ctrl+K` then `#55`) does the same from anywhere.

Validation is *pre*-commit, not post-close: a non-numeric entry with no name match simply shows no results and the button stays disabled (`Field id must be numeric.` is shown under the input as helper text). A duplicate shows `F55 is already present` with a `Jump to it` action instead of silently doing nothing.

**Clear all fields.** Available from the `⋯` toolbar menu and the palette. No confirmation dialog — because it is undoable (`Ctrl+Z`) and a toast says so: `Cleared 13 fields. Undo (Ctrl+Z)`. Undo replaces confirmation everywhere in this app.

### 2.5 Validation surfacing

Three severity levels, three surfaces, one source of truth.

| Level | Row | Cell | Problems drawer | Blocks build? |
|---|---|---|---|---|
| Error | red 3px stripe | red `!` chip, red 1px cell outline | yes, with jump link | yes, until resolved or overridden |
| Warning | amber stripe | amber chip | yes | no |
| Info | teal stripe | teal chip | no (cell-only) | no |

Validation runs on three triggers: on decode (from the engine), on field blur (client-side, cheap checks only), and on build attempt (engine authoritative).

**Encode recovery replaces the two modals.** When Build fails on binary length mismatch or non-numeric content, the old app string-matched the error text and opened a Yes/No dialog that named no field, showed no expected value, and applied a global flag blindly. The replacement is an inline **resolution card** at the top of the fields pane:

```
┌───────────────────────────────────────────────────────────────────────┐
│ ! Build blocked — 2 fields need attention                             │
│                                                                       │
│   F52  Binary length mismatch                                         │
│        declared 8 bytes · value is 6 bytes (A1B2C3D4E5F6)             │
│        [Pad with zeros → A1B2C3D4E5F60000]  [Edit field]  [Skip]      │
│                                                                       │
│   F4   Numeric field contains non-digits                              │
│        "0000012.50"  →  "000001250"                                   │
│        [Strip non-digits]  [Edit field]  [Skip]                       │
│                                                                       │
│   [Apply all suggested]                      [Build anyway] [Dismiss] │
└───────────────────────────────────────────────────────────────────────┘
```

Per-field choice, visible before/after values, no blind Yes. `Apply all suggested` reproduces the old global-flag behavior for operators who want it, and it lands as one undo entry.

`ENGINE REQUIREMENT:` errors must be structured — `{ ok:false, error:{ code:"FIELD_BINARY_LENGTH_MISMATCH", message, details:{ fieldId, expectedLength, actualLength } } }`. The UI must never string-match `"binary length mismatch"` or `"expects numeric value"`; the current coupling silently breaks the recovery path on any backend wording change.

### 2.6 Decode / Build and the staleness model

Two primary actions, and a visible relationship between them.

- **Decode** (`Ctrl+Enter`) — raw → fields. Never touches the raw text.
- **Build** (`Ctrl+Shift+Enter`) — fields → raw.

The old Build replaced the raw buffer *and* immediately re-decoded it, destroying any manual formatting or partial edit with no warning. New behavior:

1. Build writes the encoded result into the raw pane and pushes a single undo entry (`Build · replaced 148 bytes`).
2. It does **not** auto re-decode. The field table is already the source of that encoding, so re-decoding is a round trip that can only lose information. Instead, a `verified` check appears next to Build when the fresh raw round-trips back to identical fields; the check is computed silently in the background via a second `invoke` and never mutates the table.
3. If the operator edited the raw text after a decode, the fields pane header shows `Fields are stale · raw edited [Decode]`. If the operator edited fields after a decode, the raw pane header shows `Raw is stale · fields edited [Build]`. Two small amber pills, never a modal, never an automatic overwrite.

**Undo** covers: field value edits (coalesced per cell per 500ms), add field, remove field, clear all, reset to defaults, packager switch, encoding conversion, Add length, Build, Decode, resolution-card fixes. Stack depth 100 per buffer tab, `Ctrl+Z` / `Ctrl+Shift+Z`. The **History** rail entry (`Alt+0`) shows the same stack as a timeline with timestamps and a `Restore` button per entry, plus a diff preview of what changed.

### 2.7 Buffer encoding control

The old encoding combobox mutated content on change and could silently revert itself via `encodingGuard`, reporting only in a truncated status line. Replacement:

- The control is a segmented `Text│Hex` in the raw pane header with the detection chip described in 2.1.
- Switching **previews** the conversion when it is lossy: `Converting to Text will lose 4 non-ASCII bytes. [Convert anyway] [Cancel]`.
- When conversion is impossible, the control does not move; an inline note appears under it: `Text mode does not support non-ASCII characters. Switch to Hex.` with the offending byte offsets listed and clickable.
- All four legacy non-ASCII error strings are preserved verbatim as message text, but rendered inline at the control or on the offending field, never as a global truncated line.

---

## 3. Tool surfaces

### 3.0 Common tool chrome

Every tool in the dock shares one frame, so muscle memory transfers:

```
┌──────────────────────────────────────────────┐
│ ▾ MAC · auth-req.bxb              ⓘ  ⤢  📌 ✕ │   header 32px
├──────────────────────────────────────────────┤
│  Section label                               │   11px uppercase, letter-spaced
│  [ controls, single column, 8px gutter ]     │
│                                              │
│  ── divider ──                               │
│  Section label                               │
│  [ controls ]                                │
├──────────────────────────────────────────────┤
│  RESULT                              ⧉ ⟳     │   result block, tinted panel
│  [ read-only value(s), copyable ]            │
│  provenance line, 11px muted                 │
├──────────────────────────────────────────────┤
│  [Primary ⌃⏎]  [Secondary ⌃⇧⏎]      [Clear]  │   sticky action bar 44px
└──────────────────────────────────────────────┘
```

- `▾` collapses the tool to its header (state retained, and the header shows a one-line summary of the last result).
- `ⓘ` toggles a help disclosure with the tool's contextual help line — the old app's help text is preserved but no longer occupies permanent vertical space.
- `⤢` promotes to a full workspace tab.
- `📌` pins the tool so `Esc` and rail toggles do not close it.
- `✕` closes and **wipes any secret fields in that tool** (Section 5.5).
- Body scrolls internally. **No tool has a fixed pixel height.** The old fixed sizes (500x630 PIN inside a 700px window, 570px RSA, 600px TLV) clipped their own bottom rows.
- Errors render in a red-tinted strip immediately above the action bar, wrapped, full text, with a `⧉` copy and a `Details` disclosure carrying the raw engine payload.
- Results go stale visibly: changing any input greys the result block to 55%, strikes nothing, and adds `inputs changed` to the provenance line. Stale results can still be copied — they are just labeled.

### 3.1 MAC

**Sections:** Scope · Key · Options · Result.

| Control | Type | Default | Notes |
|---|---|---|---|
| Packager MAC metadata | readout | `Method FULL · Size 8 · Fields 64, 128` | When absent, the tool renders an **empty state** (below), not a wall of grey |
| `MAC field` | number 0..128, or select when the packager declares several | `packagerMacFieldIds[0]` | Preserved from `macFieldId` |
| `Padding` | select | `ISO9797 M1` | Options: `ISO9797 M1`, `ISO9797 M2` |
| `MAC key` | secret input | empty | Masked with reveal-on-hold; placeholder `MAC key hex (8, 16, or 24 bytes)`; live length badge `16/16 ✓`; KCV shown once valid |
| `Include length header in MAC input` | checkbox | off | Preserved |

**Actions:** `Calculate` (primary, `Ctrl+Enter`) · `Verify` (secondary, `Ctrl+Shift+Enter`) · `Apply to field`.

**Result block — the key fix.** Calculate and Verify no longer share one output slot:

```
RESULT                                              ⧉
Calculated   9A4C 71E2 88B0 3D51
Received     9A4C 71E2 88B0 3D50      ← from F64
Expected     9A4C 71E2 88B0 3D51
             ┈┈┈┈ ┈┈┈┈ ┈┈┈┈ ┈┈┈┈┈
             MISMATCH · differs at byte 8
ISO9797 M2 · key 16 bytes (KCV 4A2B71) · scope FULL · 132 bytes incl. header
```

- Received vs Expected are shown side by side with byte-level diff underlining — the operator no longer eyeballs the field grid.
- The verdict chip is `MATCH` (teal, with a check glyph) / `MISMATCH` (red, with a cross glyph) — never color alone.
- The verdict **clears the moment any input changes** (key, field id, padding, include-header, or any field value). The old stale `Match` lingering after an edit is a correctness hazard in a banking tool.

**Empty state when the packager has no MAC metadata:**

```
   This packager (STX21) declares no MAC configuration.
   MAC calculation needs a MAC field id, method, and size.

   [Choose a packager with MAC…]   [Open packager XML…]   [Configure manually]
```

`Configure manually` unlocks the controls with a warning chip `manual config — not from packager`, which is strictly better than a dead panel with a grey sentence and no path forward.

### 3.2 PIN

The four sub-tools become **four sub-tabs with fully independent state**, replacing one combobox with show/hide visibility rules that made the layout jump and left stale values bleeding across unrelated operations.

```
┌──────────────────────────────────────────────┐
│ ▾ PIN · auth-req.bxb                 ⓘ ⤢ 📌✕│
├──────────────────────────────────────────────┤
│ [PIN Blocks] [Visa PVV] [IBM 3624] [Translate]│
├──────────────────────────────────────────────┤
```

A `Carry over ▾` control in each sub-tab's header explicitly copies PAN / Clear PIN from another sub-tab — the sharing is now a deliberate one-click action with visible provenance (`PAN from PIN Blocks`), not invisible shared state.

#### 3.2a PIN Blocks

| Control | Type | Options / default | Notes |
|---|---|---|---|
| `Format` | segmented | `ISO-0` `ISO-1` `ISO-3` `ISO-4`, default ISO-0 | All four preserved |
| `PAN` | text | empty | For ISO-1 it is disabled **with a stated reason** under it: `ISO-1 does not bind the PAN.` The old silent grey-out is gone |
| `Clear PIN` | secret | empty | Masked, reveal-on-hold, digit-only input, length badge `4` |
| `Clear PIN block` | hex input | empty | Placeholder `Clear <format> PIN block hex`. Hidden for ISO-4 with a note `ISO-4 has no clear block stage.` |
| `Key` | secret | empty | Placeholder per format: ISO-4 → `AES key hex (16, 24, or 32 bytes)`; others → `PIN key hex (16 or 24 bytes for optional 3DES)`. Live length badge + KCV |
| `Encrypted PIN block` | hex input | empty | Placeholder `Encrypted ISO-4 PIN block hex` for ISO-4, else `3DES encrypted PIN block hex`. **Always visible** — never again a hidden carrier for another sub-tool |

**Actions:** `Create` · `Decode` · `Encrypt` · `Decrypt` · `Load F52` · `Apply F52`.

- `Encrypt` / `Decrypt` are disabled for ISO-4 with an inline note: `ISO-4 encrypts inside Create and Decode.`
- `Decode` writes the recovered PIN into a **separate `Recovered PIN` result row**, not over the operator's `Clear PIN` input. Same for `Decrypt` → `Recovered clear block`. A `↑ use as input` arrow moves a result into the corresponding input deliberately.
- `Load F52` reads field 52 from the active buffer; if absent, an inline note `Field 52 is not present in auth-req.bxb. [Add F52]`.
- `Apply F52` writes into field 52, creating it in bit order (`PIN DATA`, `Binary`) if needed, and flashes the target row in the field table so the operator sees where it landed.
- Generalization: the row menu in the field table can send any field here, and the tool header shows `target: F52 ▾` so a host that carries the PIN block elsewhere is supported.

#### 3.2b Visa PVV

`PAN` · `Clear PIN` (secret) · `PVKI (one digit)` · `PVK` (secret, `PVK hex (8, 16, or 24 bytes)`) → `Calculate PVV` → result `PVV` with copy.

#### 3.2c IBM 3624

`Clear PIN` (secret) · `Validation data (16 digits)` · `Decimalization table (16 digits)` prefilled `0123456789012345` with a `reset to default` affordance · `PVK` (secret) · `PIN offset` → `Calculate Offset` (primary) and `Verify` (secondary).

Results are two labeled rows — `Offset` and `Natural PIN` — plus a verdict chip on Verify. The old app crammed `"<status> | Natural PIN: <x>"` into one text field.

#### 3.2d ATM Translate

Two-column layout, Source and Destination side by side, which is what the operation actually is:

```
SOURCE                              DESTINATION
Block   [ ................ ]        Format    [ANSI / ISO-0 (ATM) ▾]
        [Load F52]                  Algorithm [DES ▾]
Format  [ANSI / ISO-0 (ATM) ▾]      Key       [ •••••••• 👁 ]
Algo    [DES ▾]
Key     [ •••••••• 👁 ]             PAN  [ ............ ]   (shared)

                    [ Translate ⌃⏎ ]

RESULT                                                    ⧉
Translated block   A1B2 C3D4 E5F6 0718
DES → 2-key 3DES · ANSI/ISO-0 → ISO-1 · PAN bound
                                              [Apply to F52]
```

- Source format options: `ANSI / ISO-0 (ATM)`, `ISO-1 (ATM)`. Destination format: identical two options.
- Source algorithm: `DES`, `2-key 3DES`. Destination algorithm: `DES`, `2-key 3DES`, `TSN-DES` — with a subtitle on the destination select: `TSN-DES is destination-only.`
- Destination key placeholder tracks the algorithm (`Destination DES key hex (8 bytes)` vs `Destination key hex (16 bytes)`), as before.
- **`Load F52` loads into the visible Source block field.** It no longer routes through an invisible control from another sub-tool. `Apply to F52` takes the visible translated output. This removes the single most opaque piece of hidden state in the old app.

**PIN-wide rules:** every key and every clear PIN in this tool is a secret input — masked by default, reveal only while a button is held, excluded from persistence, excluded from logs and diagnostics, and wiped on tool close, on `Ctrl+Alt+L`, and after 15 minutes idle. The old inconsistency (ATM Translate keys masked, PIN key / PVK / AES key plaintext) is gone. A persistent footer note in the PIN tool reads: `Clear PINs and keys are held in memory only. Nothing here is saved or logged.`

### 3.3 Crypto

| Control | Options | Default |
|---|---|---|
| `Algorithm` | `DES-ECB`, `DES-CBC`, `3DES-ECB`, `3DES-CBC`, `AES-128-ECB`, `AES-128-CBC`, `AES-256-ECB`, `AES-256-CBC` | `DES-ECB` |
| `Input` | `Text In`, `Hex In` | `Text In` |
| `Output` | `Text Out`, `Hex Out` | `Hex Out` |
| `Key` | secret hex | empty |
| `IV` | hex | empty |
| `Use block padding` | checkbox | on |
| Input body | textarea | empty |
| Output body | read-only textarea | empty |

Reorganized into `Algorithm` / `Key material` / `Data` sections, with three fixes:

1. The algorithm select shows the required key size per option (`AES-256-CBC · 32-byte key · IV required`), and the key field validates length **before** Run: `Key is 8 bytes, AES-256 needs 32.` inline, with Encrypt/Decrypt disabled. No more terse post-hoc backend errors after an algorithm switch left a stale key.
2. The `IV` field is disabled for ECB modes with the note `ECB does not use an IV.` — the old always-enabled IV that was silently ignored is a correctness trap.
3. Output block gains `⧉ Copy`, `⇄ Send output to input` (for chained operations), `→ Send to buffer`, and `→ Send to field…`.

A `Recent runs` disclosure lists the last 20 operations as `AES-128-CBC · encrypt · 32 in / 32 out · 11:42:07` with a `re-run` action. **Keys are not stored in history** — re-run re-uses the key currently in the field and says so if it is empty.

### 3.4 RSA

Split into two sub-tabs so the signature and the ciphertext stop sharing one text area. This is the single most destructive overlap in the old app: `Encrypt` after `Sign` silently destroyed the signature, and `Decrypt` overwrote the payload the operator still needed.

```
[ Sign / Verify ]  [ Encrypt / Decrypt ]
```

**Keys section (shared by both sub-tabs, collapsible):**

- `Private key (PEM)` — collapsed by default to a one-line summary once loaded (`RSA private key · 2048 bit · loaded 11:40`), expandable to the full textarea. Treated as a secret: memory only, wiped on close/lock.
- `Public key (PEM)` — same, not secret.
- `Load from file…` on both — **new**, closing the gap the old app left despite already shipping file dialogs. Desktop: native dialog via Tauri. Web: file input + drag-drop onto the key box.
- `Clear keys` button.

**Sign / Verify sub-tab:** `Digest` select (`SHA-256`, `SHA-1`, `SHA-512`, default SHA-256) · `Payload` textarea · `Signature (Base64)` textarea, wrap-anywhere, with copy · actions `Sign` (primary) and `Verify` (secondary) · verdict chip `MATCH` / `MISMATCH` with icon and provenance (`SHA-256 · 2048-bit key · 344-byte payload`).

**Encrypt / Decrypt sub-tab:** `Padding` select (`OAEP SHA-256`, `OAEP SHA-1`, `PKCS1 v1.5`, default OAEP SHA-256) · `Plaintext` textarea · `Ciphertext (Base64)` textarea · actions `Encrypt` and `Decrypt`. **Decrypt writes to a separate `Decrypted plaintext` result block** with a `↑ use as plaintext` action; it never overwrites the input.

The overloaded single status label is retired: verdicts (`MATCH`/`MISMATCH`) are chips on the verify result; operation confirmations (`Encrypted`, `Decrypted`) are toasts plus Problems-log info entries. Distinct error states are distinguished: `Key failed to parse (not a valid PEM private key)` vs `Signature did not match` are different messages with different severities.

### 3.5 TLV

The weakest view in the old app becomes the strongest. Best used promoted to a workspace tab (`⤢`), where it takes a three-pane layout; in the dock it stacks vertically.

**Mode:** segmented `Parse` · `Build` · `To XML` · `From XML` — all four operations preserved, but `To XML` and `From XML` now share **one two-pane converter** with a direction toggle, so nothing silently rewrites the input:

```
[Parse] [Build] [ To XML ⇄ From XML ]

TLV HEX                          │  XML
9F02 06 000000001000             │  <tlv>
9F03 06 000000000000             │    <node tag="9F02" len="6">…</node>
5F2A 02 0364                     │    <node tag="9F03" len="6">…</node>
                                 │  </tlv>
                        [ → Convert ]   [ ← Convert ]
```

Both sides are editable, both are preserved, and the direction is an explicit button press. The old behavior (Convert replaced the input area with XML, wrote the instructional sentence `XML is now editable in the input area.` into the *Tree output box*, and flipped the mode combobox by itself) is entirely removed.

**Parse mode:**

| Control | Notes |
|---|---|
| `Field` number 0..128, default 48 | Preserved |
| `Load Field` | Preserved. Error becomes inline: `Field 55 is not present.` with `[Add F55]` |
| `Apply to Field` | **New.** Writes the current encoded hex back into the field. The old app had Load with no counterpart, forcing manual copy/paste |
| `Input` | `Hex In` / `Text In`, default Hex In |
| `Parse` | Primary action |
| `Validate` | **New control for the already-implemented, previously unreachable `validateTlv`.** README advertised TLV validation; now it exists in the UI. Shows a structural verdict plus a list of issues (`tag 9F26 length 8 exceeds remaining 6 bytes`) |

**Views:** `Encoded` (read-only hex, copyable) and then a segmented `Tree` / `Flat`, both real data views instead of read-only text blobs.

`Tree` — a virtualized tree grid:

```
▾ E1              constructed   24 bytes
  ├ 9F02          Amount, Authorised            6   00 00 00 00 10 00   ⧉ ✎
  ├ 9F03          Amount, Other                 6   00 00 00 00 00 00   ⧉ ✎
  └ ▾ 5F2A        Transaction Currency Code     2   03 64                ⧉ ✎
```

- Expand/collapse per node, `Expand all` / `Collapse all`, arrow-key navigation, `Enter` to edit a node value in place.
- Tag dictionary: EMV tag names shown where known, `unknown tag` otherwise, with the dictionary source noted in the tool's help disclosure.
- Per-node `⧉` copies tag, length, value, or the whole node TLV.
- Editing a node marks the tree dirty and enables `Re-encode`, which regenerates `Encoded` — so the tree is an editor, not a printout.

`Flat` — a table with columns `Path`, `Tag`, `Name`, `Len`, `Value (hex)`, `Value (ascii)`, sortable, filterable, copyable as TSV.

**Build mode:** `Tag hex` · `Value mode` (`Hex Value` / `Text Value`, default Hex Value) · `Constructed TLV (input is child TLV hex)` checkbox · value textarea whose placeholder tracks the mode exactly as before (`Child TLV hex payload` / `Value hex` / `Value text`) · `Build` → `Encoded`. Build mode now **also** shows the `Field` + `Load Field` controls (the old app hid them in Build, so there was no way to build starting from an existing field value) and offers `Apply to Field`.

### 3.6 IranSystem

| Control | Options | Default |
|---|---|---|
| `Field` | 0..128 | 48 |
| `Load Field` / `Apply to Field` | — | Apply is **new** |
| `Profile` | `Normalized`, `ATM Engine` | Normalized |
| `Direction` | `Decode IranSys`, `Encode IranSys` | Decode IranSys |
| `Encoding` | `UTF-8`, `ANSI`, `Hex` | UTF-8 |
| `Convert digits to IranSystem` | checkbox | on |
| `Swap` | button | — |

Layout: a compact control row (Profile / Direction / Encoding as three selects), then a **side-by-side input/output** so a round trip is verifiable at a glance:

```
Profile [ATM Engine ▾]   Direction [Decode IranSys ▾] ⇄   Encoding [Hex ▾]
Convert digits to IranSystem  [✓]  (encode only)

INPUT (IranSystem, Hex)              OUTPUT (UTF-8)
81 92 A0 FE 20 …                     خرید از فروشگاه
                                     ─────────────────
                                     Hex   D8AED8B1DB8CD8AF20…      ⧉
Transform: atmEngineIranSystemToUnicode · digits converted · 24 bytes in / 17 chars out
```

Fixes:

- **`Swap` is finally a control.** `swapIranSystemDirection()` existed in the old QML and no button invoked it. The `⇄` button next to Direction swaps input and output, flips the direction select, and clears the meta line.
- **Provenance line** names the exact transform that ran. The profile × direction × encoding matrix produces materially different bytes; the old app gave no clue which of the ~12 branches executed.
- **`Convert digits to IranSystem` stays visible when decoding**, disabled with the note `(encode only)`. Vanishing controls hide state.
- The raw hex result is a **selectable field with a copy button**, not an 11px muted meta label.
- Persian output renders with `dir="rtl"` and a Persian-capable font stack; the hex line stays LTR and monospace.

### 3.7 Toolbox (was Banking Tools)

The flat 21-item combobox becomes a two-column tool: a searchable grouped operation list on the left (160px), the operation's own form on the right. All 21 operation names are preserved verbatim as the values passed to the engine.

```
⌕ search ops        │  KCV
────────────────────│  Key check value: encrypt a zero block under the key
BCD                 │  and take the leading bytes.
  BCD Encode Left   │
  BCD Encode Right  │  Key (hex)   [ •••••••••••••••• 👁 ]  16/16 ✓
  BCD Decode Left   │  KCV bytes   [ 3 ⇅ ]
  BCD Decode Right  │
BITWISE             │  [ Run ⌃⏎ ]
  XOR Hex           │
BASE64              │  RESULT                                    ⧉
  Base64 Encode Text│  4A2B71
  Base64 Encode Hex │  KCV · 3 bytes · key 16 bytes
  Base64 Decode Text│
  Base64 Decode Hex │  RECENT
HASHES              │  4A2B71  key ••••…  11:41   [re-run]
  MD5               │  9C0E33  key ••••…  11:38   [re-run]
  SHA-1             │
  SHA-256           │
  SHA-512           │
CARD NUMBERS        │
  Luhn Check        │
  Luhn Generate     │
KEY MANAGEMENT      │
  Adjust Odd Parity │
  Check Odd Parity  │
  Random Key        │
  KCV               │
CHARACTER SETS      │
  ASCII to EBCDIC   │
  EBCDIC to ASCII   │
```

Per-operation form composition — the biggest fix here is that each operation shows only the inputs it actually uses, with a correctly *labeled* parameter:

| Operation group | Inputs rendered |
|---|---|
| BCD Encode/Decode Left/Right | `Input`, `Digits` (the parameter, labeled) |
| XOR Hex | `Input (hex)`, `Second value (hex)` |
| Base64 (4 variants) | `Input` only |
| MD5 / SHA-1 / SHA-256 / SHA-512 | `Input`, `Input mode` segmented `Text input` / `Hex input` |
| Luhn Check / Generate | `Input (PAN)` |
| Adjust / Check Odd Parity | `Key (hex)` |
| Random Key | `Key bytes` (the parameter, labeled) |
| KCV | `Key (hex)` (secret), `KCV bytes` (the parameter, labeled) |
| ASCII to EBCDIC / EBCDIC to ASCII | `Input` |

This removes three real traps: the `Text input / Hex input` select that was inert for 17 of 21 operations but stayed fully enabled; the `Second hex value (XOR)` field that was silently repurposed as the hash input-mode carrier and discarded whatever the operator typed; and the single parameter spinbox that meant three different things with only a hover tooltip as a clue.

Result block: copy, `⇄ send output to input` (chaining), and `Recent` history of the last 20 runs per operation. History stores inputs and outputs for non-key operations; for `KCV`, `Random Key`, and the parity operations it stores the **result and a masked key hint only** — never the key.

### 3.8 Network (ISO TCP tester)

Desktop-only. On web it renders the capability-gate state described in 5.7.

```
ENDPOINT                                             [Saved ▾] [Save endpoint]
Host      [ 10.20.30.40                  ]
Port      [ 5000  ⇅ ]     Timeout  [ 5000 ⇅ ] ms

FRAMING
Mode      [None │ ASCII │ Binary]     Header size [ 4 ⇅ ] 🔒
Input     [Hex │ Text]                Output      [Hex Out │ Text Out]

REQUEST                                        [Load Buffer] [⧉]
[ ................................................ ]

              [ Send ⌃⏎ ]     [ Cancel ]     ● connecting… 0.8s

RESPONSE                                                        ⧉
[ ................................................ ]
Bytes      148                                                  ⧉
Elapsed    212 ms                                               ⧉
Wire hex   30313438 30323130 F23C4491 …                         ⧉
                                        [ Decode response in workspace ]

HISTORY
11:42:07  10.20.30.40:5000  ASCII/4  148→132B  212ms  ok    [resend] [load]
11:39:51  10.20.30.40:5000  ASCII/4  148→0B    5000ms timeout [resend]
```

Every fix here addresses a named pain point:

- **Every field is labeled.** The old row of three unlabeled spinboxes (port, timeout, header size) with no units is replaced by labeled fields, and the timeout carries an explicit `ms` suffix.
- **Header size stops silently resetting.** It is disabled for `None` framing, defaults to 4 (2 for Binary) with range 1–8 (1–4 for Binary), but a lock toggle pins a manually entered value against the framing change. Unlocked, a framing change shows a 2-second `size reset to 2 (Binary default)` inline note rather than mutating in silence.
- **Response metadata becomes three separate copyable rows** instead of one 11px wrapping label holding byte count, elapsed time, and the entire wire hex.
- **In-flight state is visible:** the Send button becomes a progress state with a live elapsed counter and a working `Cancel`. A send that can block for 120 seconds must never look frozen.
- **`Decode response in workspace`** — new. Pushes the response into a new buffer tab (or the active one, via a dropdown) and decodes it. The old app was one-directional: `Load Buffer` in, nothing out.
- **Saved endpoints and history.** Host/port/framing/header-size/input-mode profiles are named and persisted (never any payload that looks like key material — see 5.5). History rows resend or reload a prior request.
- Connection errors get their own error strip with the failure class named (`Connection refused`, `Host unreachable`, `Timed out after 5000 ms`, `Short read: expected 132 bytes, got 96`) instead of a truncated global line.

### 3.9 Settings

A full workspace tab (`Ctrl+,`), not a 320x472 fixed popover whose bottom controls fell off short windows. Left sub-nav, right content pane.

**Packagers.** Source path (elided, with `Reveal in folder` on desktop) · `Browse…` · `Reload` · active packager picker (all 32 options) · a read-only table of the active packager's field definitions (`Bit`, `Name`, `Type`, `Len`) which is useful reference material that the old app loaded but never showed · MAC metadata readout.

**Engine.** `Legacy ATM Engine` checkbox, default off, with the full tooltip text promoted to visible body copy: *Use AlmasPlus packed BCD, binary bitmap, length-prefix, and field-flag rules.* Below it, the framing consequences are stated as a table rather than applied invisibly:

| Packager family | Header enabled | Auto | Mode | Size |
|---|---|---|---|---|
| HYPERCOM | on | on | Binary | 2 |
| DATASET, TABLE*, AMNT*, STX*, STMNT2003, BIT121 | off | off | — | — |
| (removed: SLMLink is no longer a shipped packager) |||||
| all others | on | on | ASCII | 4 |

Toggling it shows a preview of what will change for the current packager and offers `Apply` / `Cancel`. When on, the command bar pill reads `ENGINE: LEGACY` in amber — the old app gave no indication anywhere in the main view that a mode with this blast radius was active.

**Framing defaults.** `Auto-detect decode` (default on) · `Include on build` (default off) · `Header mode` `ASCII`/`Binary` · `Header size` 1–8 default 4. These are the *defaults for new buffers*; each buffer tab then owns its own framing (edited in the raw pane).

**Buffers and session.** `Open…` · `Save` · `Save As…` · Recent buffers list with paths, timestamps, and pin/remove. Autosave-drafts toggle (default on, see 5.5). Current path display.

**Appearance.** Theme `System` / `Dark` / `Light` (light ships at full parity) · Density `Compact` / `Comfortable` · UI scale 90–150% · Monospace font choice · `Reduce motion` (`System` / `Always`) · field color palette on/off for the ribbon and byte view.

**Keyboard.** Full shortcut sheet, searchable, with rebinding. Conflicts are flagged, including browser-reserved conflicts on the web build.

**Security.** A read-only statement of the persistence rules (Section 5.5), the idle-wipe timeout (default 15 minutes, configurable 1–120 or off), `Mask PAN in field table` toggle (default off), and a `Clear all secrets now` button.

**Diagnostics / About.** This absorbs the old Info popover and fixes it. Creator `Amirsalar Saberi rad`; the ownership statement verbatim (*All rights, ownership, and licensing for this app belong to Amirsalar Saberi rad.*); the link `https://amirsrad.ir` opened via the shell opener on desktop and `target="_blank" rel="noreferrer"` on web. Plus what the old panel entirely lacked: app version, build date and commit, core engine version, transport (`WASM` / `Native IPC`), OpenSSL or crypto backend version, packager file path and hash, license text link, docs link, and a `Copy diagnostics` button that emits a scrubbed report (Section 5.5 guarantees no secret appears in it).

---

## 4. Keyboard model

### 4.1 Command palette — `Ctrl+K`

A Radix dialog, 640px wide, anchored 15% from the top. Fuzzy-matched, scored by recency then frequency then match quality. Rows show: icon, label, context suffix (`in auth-req.bxb`), and the bound shortcut right-aligned. `↑ ↓` navigate, `Enter` runs, `Ctrl+Enter` runs and keeps the palette open (for chained runs), `Esc` closes. Disabled commands still appear, greyed, with the reason as the subtitle (`requires desktop`, `requires a MAC-capable packager`) — discovery matters more than tidiness.

**Prefixes:**

| Prefix | Scope |
|---|---|
| *(none)* | Everything: commands, open buffers, tools, settings sections |
| `>` | Commands only |
| `#` | Fields — by bit number or name. `#55` adds/jumps to F55; `#track` finds F35 |
| `@` | Packagers — all 32, selects on Enter |
| `/` | Tools — opens/focuses in the dock |
| `!` | Problems — jumps to an error |
| `?` | Help / shortcut lookup |

**Full command list.**

*Buffer*
`Decode buffer` · `Build buffer` · `Toggle auto-decode` · `Identify packager` · `Paste and decode` · `Add length header` · `Remove length header` · `Convert buffer to hex` · `Convert buffer to text` · `Cycle raw view (Text/Hex/Bytes)` · `Toggle byte view` · `Toggle follow selection` · `Copy raw buffer` · `Copy raw as hex` · `Copy raw as text` · `Copy raw as byte array` · `Copy hex dump` · `Clear buffer` · `New buffer` · `Duplicate buffer` · `Close buffer` · `Reopen closed buffer` · `Next buffer` · `Previous buffer` · `Open buffer file…` · `Save buffer` · `Save buffer as…` · `Reveal buffer file` (desktop) · `Export fields as JSON` · `Export fields as CSV` · `Import fields from JSON`

*Fields*
`Add field…` · `Remove selected field` · `Clear all fields` · `Reset to packager defaults` · `Toggle hex on field` · `Expand value editor` · `Trim field whitespace` · `Copy field value` · `Copy field as hex` · `Copy field row as JSON` · `Copy all fields as JSON` · `Copy all fields as TSV` · `Filter fields…` · `Toggle present-only` · `Toggle errors-only` · `Toggle offset column` · `Toggle density` · `Jump to bit…` · `Select field bytes in raw` · `Send field to TLV` · `Send field to IranSystem` · `Send field to Crypto` · `Send field to PIN`

*Packager and framing*
`Select packager…` · `Reload packager file` · `Open packager file…` · `Show packager field definitions` · `Toggle Legacy ATM Engine` · `Toggle auto-detect framing` · `Toggle include header on build` · `Set framing mode: ASCII` · `Set framing mode: Binary` · `Set header size…` · `Lock header size`

*MAC*
`Open MAC` · `Calculate MAC` · `Verify MAC` · `Apply MAC to field` · `Set MAC field…` · `Set MAC padding: ISO9797 M1` · `Set MAC padding: ISO9797 M2` · `Toggle include length header in MAC` · `Clear MAC key`

*PIN*
`Open PIN` · `PIN: Create block` · `PIN: Decode block` · `PIN: Encrypt block` · `PIN: Decrypt block` · `PIN: Load F52` · `PIN: Apply F52` · `PIN: set format ISO-0 / ISO-1 / ISO-3 / ISO-4` · `Calculate Visa PVV` · `Calculate IBM 3624 offset` · `Verify IBM 3624 PIN` · `Translate ATM PIN block` · `PIN: swap source and destination` · `Clear PIN secrets`

*Crypto*
`Open Crypto` · `Crypto: Encrypt` · `Crypto: Decrypt` · `Crypto: set algorithm…` (8 sub-commands, one per algorithm) · `Crypto: swap output to input` · `Crypto: send output to buffer` · `Crypto: send output to field…` · `Toggle block padding` · `Clear crypto key`

*RSA*
`Open RSA` · `RSA: Sign` · `RSA: Verify` · `RSA: Encrypt` · `RSA: Decrypt` · `RSA: set digest SHA-256 / SHA-1 / SHA-512` · `RSA: set padding OAEP SHA-256 / OAEP SHA-1 / PKCS1 v1.5` · `Load private key file…` (desktop) · `Load public key file…` (desktop) · `Clear RSA keys`

*TLV*
`Open TLV` · `TLV: Parse` · `TLV: Build` · `TLV: Validate` · `TLV: to XML` · `TLV: from XML` · `TLV: Load field` · `TLV: Apply to field` · `TLV: Expand all` · `TLV: Collapse all` · `TLV: Re-encode from tree` · `TLV: toggle constructed` · `TLV: set input Hex In / Text In` · `TLV: set value Hex Value / Text Value`

*IranSystem*
`Open IranSystem` · `IranSystem: Convert` · `IranSystem: Swap direction` · `IranSystem: Load field` · `IranSystem: Apply to field` · `IranSystem: profile Normalized / ATM Engine` · `IranSystem: encoding UTF-8 / ANSI / Hex` · `Toggle digit conversion`

*Toolbox* — `Open Toolbox`, `Toolbox: Run`, plus one direct command per operation so `Ctrl+K sha256` runs it in two keystrokes:
`Toolbox: BCD Encode Left` · `BCD Encode Right` · `BCD Decode Left` · `BCD Decode Right` · `XOR Hex` · `Base64 Encode Text` · `Base64 Encode Hex` · `Base64 Decode Text` · `Base64 Decode Hex` · `MD5` · `SHA-1` · `SHA-256` · `SHA-512` · `Luhn Check` · `Luhn Generate` · `Adjust Odd Parity` · `Check Odd Parity` · `Random Key` · `KCV` · `ASCII to EBCDIC` · `EBCDIC to ASCII`

*Network*
`Open Network` · `Send request` · `Cancel request` · `Load buffer into request` · `Decode response in workspace` · `Save endpoint…` · `Select endpoint…` · `Resend last request` · `Clear history`

*View and app*
`Toggle command palette` · `Toggle tool dock` · `Promote tool to tab` · `Close tool` · `Pin tool` · `Toggle Problems drawer` · `Toggle rail labels` · `Toggle theme` · `Set theme: Dark / Light / System` · `Zoom in` · `Zoom out` · `Reset zoom` · `Open Settings` · `Open About` · `Copy diagnostics` · `Keyboard shortcuts` · `Undo` · `Redo` · `Open History timeline` · `Clear all secrets` · `Check for updates` (desktop)

### 4.2 Global shortcuts

`Ctrl+Enter` is the universal rule: **run the primary action of the focused region.** `Ctrl+Shift+Enter` runs the secondary. In the workspace that is Decode / Build; in MAC it is Calculate / Verify; in RSA Sign / Verify; in Network Send / Cancel.

| Shortcut | Action | Web note |
|---|---|---|
| `Ctrl+K` | Command palette (alias `Ctrl+Shift+P`) | ok |
| `Ctrl+Enter` | Primary action of focused region | ok |
| `Ctrl+Shift+Enter` | Secondary action of focused region | ok |
| `Ctrl+Shift+D` | Identify packager | ok |
| `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Undo / Redo | ok |
| `Ctrl+S` / `Ctrl+Shift+S` | Save buffer / Save As | preventDefault |
| `Ctrl+O` | Open buffer | preventDefault |
| `Ctrl+F` | Filter fields (scoped find) | preventDefault |
| `Ctrl+B` | Toggle tool dock | ok |
| `` Ctrl+` `` | Toggle Problems drawer | ok |
| `Ctrl+Shift+\` | Promote focused tool to workspace tab | ok |
| `Ctrl+Shift+V` | Cycle raw view Text → Hex → Bytes | ok |
| `Alt+1…Alt+9`, `Alt+0` | Rail destinations | Alt chosen over Ctrl+digit because Chrome reserves Ctrl+1–9 for tab switching and does not allow preventDefault |
| `Alt+[` / `Alt+]` | Previous / next buffer tab | Ctrl+Tab is browser-reserved |
| `Alt+N` / `Alt+W` / `Alt+Shift+W` | New / close / reopen buffer | Ctrl+N, Ctrl+T, Ctrl+W are browser-reserved |
| `Alt+A` or `Insert` | Add field | ok |
| `Alt+H` | Toggle hex on focused field row | ok |
| `Alt+Enter` | Expand focused value into the value sheet | ok |
| `Alt+Shift+↑/↓` | Resize raw/fields splitter by 5% | ok |
| `F6` / `Shift+F6` | Cycle region focus forward / back | ok |
| `F2` | Begin editing the focused table cell | ok |
| `Delete` | Remove focused field (when not editing) | ok |
| `Ctrl+C` | Copy table selection as TSV (when the table has focus and no cell is editing) | ok |
| `Ctrl+Shift+C` | Copy the focused value | ok |
| `Ctrl+,` | Settings | ok |
| `Ctrl+/` | Keyboard shortcut sheet | ok |
| `Ctrl+Shift+H` | History timeline | ok |
| `Ctrl+Alt+L` | Clear all secrets ("lock") | ok |
| `Esc` | Close topmost transient: palette → value sheet → resolution card → unpinned dock overlay. Never closes a pinned tool, never discards typed input | ok |

Rebinding lives in Settings → Keyboard. On macOS builds, `Ctrl` maps to `Cmd` and the `Alt+` bindings map to `Ctrl+Option+` to avoid Option producing special characters.

### 4.3 Focus order

`F6` cycles **regions** in this order, wrapping: Command bar → Rail → Buffer tabs → Raw pane → Fields table → Tool dock (each open tool is a stop) → Problems drawer → Status strip. `Shift+F6` reverses. The focused region shows a 1px accent border on its container so the operator always knows where `Ctrl+Enter` will land.

`Tab` moves **within** a region and never escapes it except at the ends. The fields table is a single tab stop from outside (roving tabindex); inside it:

- `↑ ↓` move rows, `← →` move columns, `Home`/`End` first/last column, `Ctrl+Home`/`Ctrl+End` first/last row.
- `F2` or typing a printable character begins editing the focused cell.
- While editing: `Enter` commits and moves down, `Shift+Enter` commits and moves up, `Tab` commits and moves right, `Esc` reverts the cell to its pre-edit value (a real revert, not a blur).
- `Space` toggles row selection; `Shift+↑/↓` extends; selection drives the byte highlight.

Focus is never stolen. Decode, Build, and every tool run return focus to wherever it was, and announce their result through a live region instead (Section 6).

### 4.4 Mouse-free walkthroughs

**Decode a captured buffer and read F55.**
`Ctrl+V` (paste anywhere focuses the raw pane and pastes) → auto-decode fires → `F6` to Fields → `Ctrl+F` `55` `Enter` → `Alt+Enter` opens the value sheet with the parsed TLV tree. Six keystroke groups, zero clicks. Old app: paste, open Settings popover, pick packager, close popover, click Decode, hunt a 180px truncated cell, copy it by hand, open TLV, paste.

**Verify a MAC on a received message.**
`Ctrl+Enter` (decode) → `Alt+4` (MAC opens in the dock, field id prefilled from the packager) → `Tab` to the key field → paste key → `Ctrl+Shift+Enter` (Verify) → the verdict is announced and the Received/Expected diff is on screen next to the still-visible field table.

**Change an amount and rebuild.**
`F6` to Fields → type `4` in the filter or `Ctrl+K #4` → `F2` → type → `Enter` → `Ctrl+Shift+Enter` (Build) → `Ctrl+Shift+C` copies the new raw buffer.

**Encrypt a PIN block and put it in F52.**
`Alt+5` → sub-tab is already PIN Blocks → `Tab` through PAN, Clear PIN, Key → `Ctrl+Enter` (Create) → `Ctrl+Enter` on Encrypt via `Ctrl+K enc` → `Ctrl+K apply f52` `Enter` → `Ctrl+Shift+Enter` (Build).

**Send to a host and decode the reply.**
`Alt+9` → `Ctrl+K load buffer` → `Ctrl+Enter` (Send) → `Ctrl+K decode response` → new tab opens decoded.

**Run a KCV over a key.**
`Ctrl+K` `kcv` `Enter` → paste key → `Ctrl+Enter` → `Ctrl+Shift+C` copies the result.

---

## 5. Cross-cutting UX

### 5.1 Error presentation

#### 5.1.0 Where a message goes — routing rule

Before choosing a tier, decide whether the message belongs in the document flow **at all**. A block
inserted between the raw pane and the field table reflows the workspace, and reflow during editing is
the single most disruptive thing this UI can do. The workspace is not a notification area.

| The message is… | Goes to | Why |
|---|---|---|
| Transient, undoable, no decision needed | **Toast** with an Undo action | Nothing is lost if it is missed; the operator keeps working |
| Advisory, persistent while a condition holds | **Problems drawer** | Re-readable, filterable, costs no layout |
| An error caused by the action just taken | **Inline at the origin** | The operator is looking there; hiding it would mean hunting |
| A genuine either/or the operator must resolve before continuing | **Inline, at the control** | It blocks progress, so it earns the space |
| Background/host state (no engine, offline, degraded) | **Status strip or the affected control** | Ambient, not an event |

The test: *if this appeared while I was mid-edit and I ignored it, would anything break?* If no, it is
a toast or a drawer entry — never a block in the flow.

Applied cases:

- Switching a packager reports through a toast with **Undo**; fields the new packager does not define
  become a Problems entry. It previously rendered an inline card announcing things like "SLM defines
  23 of your 23 fields" — a non-event that displaced the field table.
- Fields the byte view cannot locate are a Problems entry, not a warning above the table. The
  condition is expected after editing, so it fired constantly during the very interaction it
  described.
- Decode and Build failures stay inline: they are direct results of a button the operator just
  pressed, and they carry the detail needed to fix the buffer.

Three tiers, no modals.

**Tier 1 — inline at the origin.** A field-level error renders under or beside the control that caused it, in full, wrapped, never elided. A row-level error renders as a chip in the cell plus a severity stripe. A tool-level error renders in the tool's error strip above its action bar.

**Tier 2 — Problems drawer** (`` Ctrl+` ``). A durable, timestamped, filterable list. This replaces the single elided right-aligned status label that was the old app's *only* error channel, where each new error silently overwrote the last.

```
PROBLEMS   2 errors · 1 warning · 4 info      [Errors│Warnings│All] [⧉ copy all] [clear]
─────────────────────────────────────────────────────────────────────────────────────────
✕ 11:42:07  Build   F52 binary length mismatch: declared 8 bytes, value is 6.   [Fix] [→]
⚠ 11:41:55  Fields  F35 has a trailing space.                                   [Trim] [→]
✕ 11:39:51  Network Timed out after 5000 ms connecting to 10.20.30.40:5000.     [Retry]
ⓘ 11:38:02  MAC     Calculated 9A4C71E288B03D51 (ISO9797 M2, 16-byte key).
```

Rows carry: severity icon (never color alone), timestamp, source tool, full untruncated message, an optional fix action, and `→` which navigates to the origin. Each row has `⧉`; `⧉ copy all` emits the whole log as text for a bug report. Entries are scoped per buffer tab where applicable, and errors auto-clear when their cause is resolved — but never merely because time passed, and never leaving a stale success next to a live failure.

**Tier 3 — toasts.** Bottom-right, 4-second auto-dismiss, for *transient successes and undoable actions only* (`Cleared 13 fields. Undo`). Errors never use toasts, because errors must be re-readable.

**Never modal.** Two exceptions to the no-dialog rule, both genuinely blocking and both about data loss the app cannot undo: closing a dirty buffer, and quitting with unsaved buffers. Everything else — including the old binary-mismatch and non-numeric dialogs — is inline.

### 5.2 Copy affordances

The old app had zero copy buttons anywhere. The rule now: **every read-only value in the application has a copy affordance, and every read-only container has a copy-all.**

- `⧉` icon button, 20x20, appearing on hover and always on keyboard focus (never hover-only — that is an accessibility failure).
- Click copies; a 1.2s checkmark confirms; a toast is not used for copies (too noisy).
- Multi-format values get a split button: click copies the default, the `▾` offers alternatives (hex / text / Base64 / JSON / TSV / with-offsets).
- `Ctrl+Shift+C` copies the focused value from anywhere.
- Table: `Ctrl+C` copies the selected rows as TSV with a header row; the `⋯` menu offers JSON.
- Byte view: selecting a byte range and copying yields the hex; `⧉ ▾` offers `hex`, `dump with offsets`, `C array`, `ASCII`.
- **Copy never includes a secret.** Key fields have a copy button only while revealed, and copying a key is recorded in the Problems log as an info entry (`MAC key copied to clipboard`) so it is auditable. Clipboard is not auto-cleared (that surprises operators) but the security note in Settings states it.

### 5.3 Undo and history

Covered per-surface in 2.6. Globally:

- One undo stack per buffer tab (workspace edits), depth 100, coalescing text edits per 500ms.
- Tool runs are **not** undoable (they are pure computations) but are re-runnable from each tool's `Recent` list, and any tool action that *writes into the workspace* (`Apply to field`, `Apply F52`, `Send to buffer`, `Decode response`) pushes a workspace undo entry.
- The History surface (`Alt+0`, `Ctrl+Shift+H`) shows the stack with timestamps, a one-line description, a change count, and a diff preview (`F4: 000000010000 → 000000012500`). `Restore` jumps the stack to that point; the entries after it stay redoable until a new edit truncates them.
- Destructive operations that previously had no confirmation *and* no undo — `Clear` fields, packager switch wiping values, buffer switch discarding edits, Build overwriting the raw — are all now undoable, which is why none of them need a confirmation dialog.

### 5.4 Empty and loading states

**Empty states** are always: a one-line statement of what is missing, a primary action, and where useful a sample.

| Surface | Empty state |
|---|---|
| Workspace, no buffer | Paste target described in 2.1, with four templates |
| Fields, buffer present but not decoded | `Not decoded yet. [Decode ⌃⏎]` plus the auto-decode toggle |
| Fields, decoded to zero fields | `Decoded 0 fields from 148 bytes. The packager may be wrong. [Identify packager]` |
| MAC, packager without MAC | The actionable empty state in 3.1 |
| TLV, nothing parsed | `Parse a TLV payload, or load one from a field. [Load F48] [Paste]` |
| Network history | `No requests yet. Configure an endpoint and send.` |
| Problems | `No problems.` in muted type — a positive empty state, not a blank panel |
| Toolbox result | `Choose an operation and run it.` |

**Loading states.** Engine calls over WASM or native IPC are sub-millisecond for decode/encode, so a spinner would be a flash of noise. The rule:

- 0–120ms: nothing.
- 120ms–2s: an indeterminate 2px progress bar along the top edge of the affected region (not a blocking overlay), and the triggering button enters a pressed-disabled state.
- >2s or unbounded (only TCP send, packager XML load over a slow path, `Identify packager` across 32 packagers): determinate progress where a total is known (`Identify packager · 14 / 32`), an elapsed counter where it is not, and a working `Cancel`.
- Skeletons only where layout would otherwise jump: the packager field-definition table and the Network history list.
- The UI thread never blocks. Native transport calls are async by construction; WASM calls that could exceed 50ms (identify-packager sweeps, large TLV trees) run in a Web Worker with the same JSON contract.

### 5.5 Session persistence and the secrets rule

Persistence is **allowlist-only**. The Zustand store is split into `persisted` and `ephemeral` slices at the type level; a slice must be explicitly declared persistable, and a lint rule plus a runtime assertion reject any key whose name matches `/(pin|key|pvk|pem|secret|password|block)/i` from entering the persisted slice. Storage is `localStorage` on web and the Tauri store plugin on desktop, both namespaced and versioned.

**Persisted:**

- Window/layout: rail collapsed state, dock width, dock contents (tool identity and pinned state only), splitter positions, Problems drawer state, active workspace tab.
- Appearance: theme, density, zoom, monospace font, reduced-motion override, field-color palette on/off.
- Table config: column visibility, widths, sort, density — per packager.
- Packager: XML path, active packager name, legacy engine mode.
- Framing defaults: auto-detect, include-on-build, mode, size.
- Buffers: recent file paths (not contents) plus, if autosave-drafts is on, a draft of each open unsaved buffer's raw text and field values under a per-tab key.
- Non-secret tool selections: crypto algorithm/input/output/padding, RSA digest and padding, TLV mode and field id, IranSystem profile/direction/encoding/digit toggle, MAC field id and padding and include-header, PIN active sub-tab and format and algorithm selections, Toolbox last operation and parameter, Network host/port/timeout/framing/header-size/input-output modes and named endpoint profiles.
- Command palette recency and frequency.
- Toolbox and Crypto run history **excluding key material**.

**NEVER persisted, under any setting, in any build:**

- Clear PINs, PIN blocks (clear or encrypted), PAN when entered in the PIN tool.
- Any symmetric key: MAC key, PIN key, AES key, PVK, crypto key, IV, ATM source and destination keys.
- RSA private key PEM. (Public key PEM is also not persisted, for uniformity of the key-handling model.)
- Decrypted plaintexts, recovered PINs, natural PINs, PVVs, offsets.
- Anything typed into a control marked `secret` in the component library.

Additional hard rules:

1. **Never in a URL.** The app uses no query parameters or hash routing for state. Routing is in-memory. This is enforced by having no router that reads or writes `location.search`/`location.hash`.
2. **Never in a log.** The engine bridge logs request *shapes* (operation name, input byte lengths, duration) and never request bodies. `console` logging of engine payloads is stripped in production builds.
3. **Never in diagnostics.** `Copy diagnostics` emits versions, layout state, packager path and hash, the Problems log with secret-bearing fields redacted to `[redacted]`, and nothing else.
4. **Never in a buffer file.** `saveBufferFile` writes packager, fields, raw, rawFormat, and the length-header block — as before. Field values *are* message content and are saved, but when a saved buffer contains F52 or F35 the save flow shows a one-line note: `This file contains PIN and track data. Store it accordingly.` Tool secrets are never in the file.
5. **Wipe triggers.** Secrets are zeroed in memory on: tool close, `Clear all secrets` (`Ctrl+Alt+L`), 15 minutes of inactivity (configurable), window/tab close, and OS lock on desktop. A rail dot and a lock icon in the command bar show whenever any secret is resident, with a tooltip listing which tools hold one (by tool, not by value).
6. **Masking.** Secret inputs render masked, with reveal only while a button is held (`press and hold to reveal`), never a sticky toggle. They are excluded from browser autofill (`autocomplete="off"`, `data-1p-ignore`), from spellcheck, and from `input` event logging.

### 5.6 Copy of state between tools

Cross-tool movement was manual, one-directional and mostly missing. The new rule: **every load has an apply, and every result can be sent somewhere.**

| Path | Old | New |
|---|---|---|
| Field → PIN | `Load F52` | `Load F52` plus a general `Send field to PIN` from any row |
| PIN → Field | `Apply F52` | Kept, plus a visible target selector |
| Field → TLV | `Load Field` | Kept, plus `Apply to Field` |
| Field → IranSystem | `Load Field` | Kept, plus `Apply to Field` |
| Buffer → Network | `Load Buffer` | Kept |
| Network → Buffer | *missing* | `Decode response in workspace` |
| Crypto → anywhere | *missing* | `Send output to input`, `to buffer`, `to field…` |
| MAC → Field | `Apply` | Kept, with target flash |
| Toolbox → anywhere | *missing* | `Send output to input`, `to field…` |

Every write into the workspace flashes the destination row for 800ms (respecting reduced-motion, which substitutes a persistent 3s outline) and pushes an undo entry.

### 5.7 Desktop vs web capability degradation

The frontend receives a capability object at boot from whichever transport is active:

```ts
{ transport: "native" | "wasm",
  tcp: boolean, nativeFileDialog: boolean, fileSystem: boolean,
  keyFileLoad: boolean, clipboardRead: boolean, shellOpen: boolean, updates: boolean }
```

Rendering rules:

- The command bar shows a transport pill: `NATIVE` (teal) or `WEB` (blue). Its tooltip states what differs.
- **Gated, never hidden.** A host-only feature always renders, in a disabled state, with a one-line reason and an alternative. Hiding features makes the web build feel broken rather than scoped.

| Capability | Native | Web |
|---|---|---|
| TCP tester | Full | Rail entry present; the tool shows: *The TCP tester needs raw socket access, which browsers do not provide. Use the desktop app, or paste a captured response into a buffer.* with `[Download desktop app]` and `[Paste a response]`. All form controls render disabled so the operator can still see the shape of the feature |
| Open/Save packager and buffer files | Native dialogs, real paths, `Reveal in folder` | File input + drag-and-drop for open; download for save. No path is shown; the tab keeps its name. `Save` behaves as `Save As` (download) with a note. If the File System Access API is available, it is used to restore real Save semantics and the note disappears |
| RSA key file load | Native dialog | File input + drag-drop onto the PEM box. Functionally equivalent; noted as such |
| Recent files | Real paths, reopenable | Names only, not reopenable; the list explains why and offers re-drop |
| Shell open of `https://amirsrad.ir` | System browser | New tab |
| Updates | Update check | Hidden entirely (the only hidden feature; it is meaningless on web) |
| Everything else — decode, build, MAC, PIN, crypto, RSA, TLV, IranSystem, Toolbox | Native IPC to the C ABI | The same WASM module in-process. Identical results; only latency differs |

Performance note surfaced to the operator: the transport pill tooltip reports the last engine call duration (`native · 0.4ms` / `wasm · 1.9ms`), which is honest about the trade and useful when diagnosing a slow sweep.

---

## 6. Accessibility

Target: WCAG 2.2 AA, in **both** themes, verified by automated axe checks in CI plus a manual keyboard and screen-reader pass (NVDA on Windows, VoiceOver on macOS) per release.

### 6.1 Focus visibility

- Every interactive element has a `:focus-visible` ring: 2px `--focus` (light-theme `#0F766E`, dark-theme `#88F2D0`) plus a 1px contrasting outer offset ring so it survives on both tinted panels and input backgrounds. Minimum 3:1 against the adjacent surface.
- Focus is never removed with `outline: none` without a replacement; a lint rule enforces it.
- The focused **region** gets a 1px accent container border (Section 4.3), so region-level focus is visible independently of element-level focus.
- The old app had no focus-ring styling and no explicit tab order at all; both are now first-class.

### 6.2 Contrast

| Token role | Dark | Light | Minimum |
|---|---|---|---|
| Body text on surface | `#F2F6FA` on `#0E141B` | `#111821` on `#FFFFFF` | 4.5:1 |
| Muted / secondary text | `#A8B4C2` on `#17202A` | `#4A5764` on `#F5F7F9` | 4.5:1 |
| Disabled text | 3:1 minimum — **not** the old 40% opacity trick | | 3:1 |
| Borders, dividers, chart/ribbon segments, focus ring | | | 3:1 |
| Error / warning / success text | `#FF9E85` / `#F2B457` / `#63E6BE` on card | tuned darker equivalents | 4.5:1 |

The legacy palette (`ink #FFFFFF`, `muted #D2DAE3`, `accent #4DD4C6`, `card #17202A`, `cardAlt #1E2833`, `border #425160`, backgrounds `#10161E`/`#0E141B`, success `#63E6BE`/`#2A9D8F`, error `#E18A74`/`#E76F51`, warning `#E9A645`, input `#121922`, stripes `#18222D`/`#1C2733`) is carried forward as the dark theme's starting point, with two mandatory corrections: `muted` is darkened for contrast where it sits on `cardAlt`, and `border #425160` is lightened to reach 3:1 where it delimits interactive elements. A full light theme ships at parity — the old app was dark-only with no switch.

**No information is conveyed by color alone.** Every status carries a glyph and a word: `MATCH` has a check, `MISMATCH` has a cross, severity stripes are paired with cell chips, the field-color ribbon is backed by the `Bit` column and tooltips, and the byte-view field tints are backed by the region ribbon labels and hover text. The field-color palette can be disabled entirely in Settings for operators with color-vision differences, replacing tints with alternating hatch patterns.

### 6.3 Screen readers and the dense tables

The field table is a real `<table>` (not a div grid), with:

- `<caption class="sr-only">ISO 8583 fields for auth-req.bxb, packager SLM</caption>`
- `<th scope="col">` on every header; `<th scope="row">` on the `Bit` cell, so every value announcement is prefixed by its bit number.
- `aria-rowcount` / `aria-rowindex` on the virtualized body so the reader announces `row 12 of 48`, not `row 12 of 22 rendered`.
- Cell content is announced as `Bit 35, Track 2 Data, type Z, length 37 of 37, value …` — the type and length columns carry `aria-label` expansions (`N` → `Numeric`).
- Diagnostic chips are `<button>`s with descriptive labels (`Trailing space in field 35. Activate to trim.`), not decorative spans.
- Roving `tabindex` with `aria-activedescendant` for the grid navigation model; edit mode is announced (`editing`).

Other patterns:

- The TLV tree is `role="tree"` with `role="treeitem"`, `aria-level`, `aria-expanded`, `aria-setsize`, `aria-posinset`.
- The byte view is `role="grid"` with row headers being the offsets; each byte cell's `aria-label` is `offset 0x0051, byte A1, field 35`.
- The structure ribbon is `role="img"` with a full `aria-label` describing the segmentation, plus a visually-hidden `<ol>` of the same segments as focusable links — a picture is not a substitute for structure.
- Results announce through `aria-live="polite"` regions; errors through `aria-live="assertive"` with `role="alert"`. The Problems drawer count is a polite live region.
- Secret inputs are `<input type="password">` with `aria-describedby` pointing at the note `Masked. Press and hold reveal to show. Not saved.`
- Every icon-only button has an `aria-label` and a tooltip with identical text. The old app had no `Accessible.name` or role on a single control, and its combobox indicator was a bare 10x10 square with no arrow glyph — the new selects use a real chevron plus a proper `role="combobox"` from Radix.
- Landmarks: `<header>` command bar, `<nav>` rail, `<main>` workspace, `<complementary>` dock, `<aside role="log">` Problems, `<footer role="status">` status strip.

### 6.4 Motion, zoom, density

- `prefers-reduced-motion: reduce` (and a Settings override) removes all slide, fade, and scale transitions: panels appear instantly, the 650ms intro animation is dropped entirely, row-flash confirmations become a 3-second static outline, and the loading progress bar becomes a static labeled state instead of an animated stripe. No animation is ever load-bearing for meaning.
- Default motion, when enabled, is capped at 160ms with `ease-out`; nothing animates on a data change, only on a layout change.
- The layout reflows correctly to 200% browser zoom and to 320px logical width without loss of function (horizontal scroll is confined to the byte view and wide tables, never the page body).
- Density modes (Compact 28px / Comfortable 34px rows) and a 90–150% UI scale let operators trade density for legibility without zooming the whole OS.
- Touch/pointer-coarse targets: all interactive controls have a minimum 24x24 hit area (32x32 on coarse pointers) even where the visual is 20px.

---

## Appendix A — Control preservation audit

Every control from the Qt inventory and its new home. `→` means preserved; notes flag deliberate reorganization.

**Main workspace**

| Old control | New home |
|---|---|
| Buffer encoding `Hex`/`Text` | → Raw pane segmented `Text│Hex`, with detection chip and lossy-conversion preview; no silent revert |
| Decode | → Raw pane, `Ctrl+Enter`, plus auto-decode |
| Build | → Raw pane, `Ctrl+Shift+Enter`; no longer auto re-decodes |
| Add length | → Raw pane framing group, with a preview before commit |
| decodeInput textarea | → Raw pane (Text/Hex/Bytes), resizable, uncapped height |
| Double-click to decode | Removed (undiscoverable, accidental) |
| Fields: Add | → Inline add row + palette `#` prefix; searches names and ids |
| Fields: Clear | → Toolbar `⋯` menu; undoable, toast with Undo |
| Fields: Reset | → Toolbar `⋯` menu, `Reset to packager defaults` |
| Field grid (2-col, 180px value) | → Single full-width virtualized table, 9 columns, resizable |
| `Hx` per-field toggle | → `Fmt` column segmented `Txt│Hex`; locked-with-reason on Binary |
| `x` per-field delete | → Row `⋯` menu and `Delete` key; no longer triggers an encode |
| Edge-space teal border | → `␣` cell chip with `Trim` action |
| Non-ASCII amber border | → `Ä` cell chip with two fix actions |

**Settings**

| Old control | New home |
|---|---|
| Packager path display, Browse | → Settings → Packagers (+ `Reload`, + `Reveal`) |
| packagerCombo (32 options) | → Command-bar picker, searchable, metadata-rich; all 32 preserved |
| Legacy ATM Engine | → Settings → Engine, with the framing table and a preview; `ENGINE: LEGACY` pill in the command bar |
| Open / Save / Save As | → Settings → Buffers, plus `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` |
| bufferSwitcher combobox | → Buffer tabs with dirty dots and close prompts |
| currentBufferPath display | → Tab tooltip + Settings → Buffers |
| Auto-detect decode | → Raw pane framing group (and Settings as a default) |
| Include on build | → Raw pane framing group (and Settings as a default) |
| headerMode `ASCII`/`Binary` | → Raw pane framing group; enabled rule fixed |
| headerSize 1–8 | → Raw pane framing group, with an origin tooltip and a lock |

**MAC** — metadata readout → Scope section (with actionable empty state); `macFieldId` → `MAC field`; padding `ISO9797 M1`/`ISO9797 M2` → preserved; `macKey` → secret input with length badge and KCV; include-header checkbox → preserved; `Calc`/`Verify`/`Apply` → preserved; `Calculated MAC` + `macVerifyStatus` → split into Calculated / Received / Expected with diff and a staleness rule.

**PIN** — `pinTool` combobox → four sub-tabs with independent state; `pinFormat` `ISO-0`/`ISO-1`/`ISO-3`/`ISO-4` → preserved; `pinPan`, `pinClearPin`, `pinClearBlock`, `pinKey`, `pinEncryptedBlock` → preserved (encrypted block now always visible); `Create`/`Decode`/`Encrypt`/`Decrypt`/`Load F52`/`Apply F52` → preserved; `pinPvki`, `pinValidationData`, `pinDecimalization` (default `0123456789012345`), `pinOffset`, `Calculate PVV`/`Calculate Offset`, `Verify`, `pinVerificationResult` → preserved in their sub-tabs; translate source block/format/algorithm/key, destination format/algorithm/key, `Translate`, output, translate-row `Load F52`/`Apply F52` → preserved in a two-column Source/Destination layout, with `Load F52` now targeting the visible source field. Source formats `ANSI / ISO-0 (ATM)`, `ISO-1 (ATM)`; source algorithms `DES`, `2-key 3DES`; destination algorithms `DES`, `2-key 3DES`, `TSN-DES` — all preserved.

**Crypto** — all 8 algorithms, `Text In`/`Hex In`, `Text Out`/`Hex Out`, key, IV, padding checkbox, input, `Encrypt`/`Decrypt`, output → all preserved; IV disabled-with-reason for ECB; key length pre-validated; output gains copy/swap/send and a run history.

**RSA** — digests `SHA-256`/`SHA-1`/`SHA-512`, paddings `OAEP SHA-256`/`OAEP SHA-1`/`PKCS1 v1.5`, payload, private PEM, public PEM, signature, `Sign`/`Verify`/`Encrypt`/`Decrypt`, status → all preserved; signature and ciphertext split into separate fields across two sub-tabs; decrypt output no longer overwrites the payload; `Load key from file…` added.

**TLV** — modes `Parse`/`Build`/`TLV to XML`/`XML to TLV` → preserved as `Parse`/`Build`/two-way converter; field id, `Hex In`/`Text In`, tag input, `Hex Value`/`Text Value`, constructed checkbox, input, `Encoded`/`Tree`/`Flat` → all preserved; Tree becomes a real tree, Flat becomes a table; `Load Field` gains `Apply to Field`; **`validateTlv` gains a `Validate` control** (previously implemented and unreachable).

**IranSystem** — field id, `Load Field`, profile `Normalized`/`ATM Engine`, direction `Decode IranSys`/`Encode IranSys`, encoding `UTF-8`/`ANSI`/`Hex`, `Convert digits to IranSystem`, `Convert`, input, output, hex meta → all preserved; **`swapIranSystemDirection` gains a `⇄` control** (previously implemented and unreachable); `Apply to Field` added; hex output becomes a copyable field; provenance line added.

**Toolbox** — all 21 operations preserved verbatim, grouped and searchable; `Text input`/`Hex input` shown only for the four hashes; `Second hex value` shown only for XOR; the parameter is labeled per operation.

**Network** — host, port, timeout, `Hex`/`Text` input, framing `None`/`ASCII`/`Binary`, header size, `Hex Out`/`Text Out`, payload, `Load Buffer`, `Send`, response, meta → all preserved and labeled; `Cancel`, `Decode response in workspace`, saved endpoints and history added.

**Info** — creator, ownership statement, `https://amirsrad.ir` → Settings → About, plus version, build, engine, transport, crypto backend, license, docs, `Copy diagnostics`.

**Status bar / footer** — `Ln/Col/Pos/Sel` → status strip, now with an explicit scope label (`Fields` / `Raw`) that the old app tracked but never displayed; state dot + message → Problems drawer + inline errors + status strip summary; ten launcher buttons → left rail (non-exclusive).

**Modals** — `Add field` → inline add row with pre-commit validation and duplicate detection; `Binary length mismatch` and `Non-numeric characters` → the inline resolution card with per-field choices and before/after previews.

**Previously unwired backend capability** — `validateTlv` and `swapIranSystemDirection` are now exposed (above). `createIso0PinBlock` / `decodeIso0PinBlock` are covered by the general `Create`/`Decode` with format ISO-0 and need no separate control. `asciiToUtf8Text`, `utf8ToAsciiText`, `ansiToUtf8Text` are internal conversions used by the IranSystem encoding matrix and the Toolbox character-set operations; they get no dedicated control. `legacyEngineMode()` getter is used to render the `ENGINE:` pill.

---

## Appendix B — Deferred to a later release

Recorded so they are not mistaken for omissions: buffer-to-buffer diff view, scripted/batch replay of a capture file, per-institution MAC presets, drag-and-drop reordering inside the TLV tree, a saved key store (deliberately deferred — a key store contradicts the memory-only rule and needs a real security design first), and multi-window support on desktop.
