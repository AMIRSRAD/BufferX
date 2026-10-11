# Packagers, structure inspection, and saved buffers

Open these tools from the destinations menu or the command palette. Tools share the active buffer;
**Split with buffer** keeps the message visible beside the selected tool on wider windows.

## Packager builder

1. Choose **New** for a fresh definition with MTI and bitmap fields, or choose an existing definition
   and click **Clone**. New clears the field filter and previous errors, selects the MTI field, and
   focuses the name. If `CUSTOM` already exists in the loaded registry, a free numbered name is used.
2. Set the name, bitmap layout, field count, MAC metadata, and length-header metadata.
3. Select a field row to edit its id, wire type, maximum length, description, and flags. Use
   **Add field** or **Remove** to change the definition. Fix validation messages before applying it.
4. **Use packager** merges the definition into the current registry, keeps other definitions, and
   selects it for the active buffer. Replacing an existing name requires confirmation.
5. **Export XML** saves this definition for future sessions. Applying a definition keeps it in memory
   for the current session; export it to retain your work. **Preview XML** and the copy control show
   the generated document. **Import XML** opens an existing definition; for a multi-definition file,
   the builder imports the first definition and reports that choice.

## TLV / LTV

**BER-TLV** retains parsing, tree editing, building, validation, and XML conversion. The **Visual** view
adds a searchable hierarchy and separate Tag, Length, and Value blocks for the selected node, with
byte offsets, value hex, and a text interpretation. Original BER length headers are used for offsets,
including valid headers with longer-than-minimal length encodings.

Choose **LTV** in the same tab for sequential Length → Tag → Value records. Select:

- Length and tag widths: 1–4 bytes each; defaults are 2 length bytes and 1 tag byte.
- Length byte order: big-endian or little-endian; default is big-endian.
- Length scope: value bytes only, or the whole record including length and tag; default is value only.

For the defaults, `00 03 01 41 42 43` means tag `01`, length `3`, value `41 42 43` (`ABC`).
Paste hex and choose **Parse LTV**, or expand **Build a record** to supply a tag and value. Tags are
opaque; LTV does not infer nested records. Field load/apply controls connect the result to the buffer.

## JSON inspector

Paste JSON, open a file, or drop a file on the panel. Validation runs automatically in a worker.
Errors report a one-based line and column plus a zero-based character offset; **Jump to error**
selects the offending source position. The editor supports syntax highlighting, folding, and Ctrl+F.

The searchable tree shows properties, array indices, types, and values. Select a row to locate its
source range and copy its JSON pointer or exact value. Search includes keys, value previews, and
pointers; string previews are limited to 180 characters. **Format** and **Minify** preserve number
spelling and duplicate properties, including integers larger than JavaScript's safe integer range.

The inspector accepts files up to 25 MB, up to 500,000 values, and nesting up to 512 levels. Tree
search/display is capped at 10,000 rows with a prompt to refine the search. Source content stays in
memory and is not saved as input history.

## Network

Network requires the desktop app. It supports raw TCP, ASCII decimal length headers, and big-endian
binary length headers. Supply the body; the host adds the selected framing once. Results expose both
body and complete wire bytes. The exchange budget is rechecked for each socket read and write, so a
peer sending bytes slowly cannot continually restart the timeout. DNS resolution uses the system
resolver and has no independent timeout. Raw responses retain bytes received before the budget
expires; incomplete framed replies report an error. IPv6 literals may include brackets.

The panel uses the same padding as other tools. Automated loopback tests cover all framing modes,
fragmented replies, invalid/oversized headers, truncated replies, no data, slow peers, and IPv6;
these do not replace testing against an institution's own host.

## Layout and library location

The active tool, open tool tabs, each tool's split preference, and dock width survive reopening.
Closing a tool retains its split preference for the next time it is opened. Narrow windows temporarily
show one workspace without discarding the preference. Tool payloads are not included in layout storage.

On desktop, the saved-buffer library defaults to a `saved-buffers` folder beside the executable,
independent of the working directory. The folder is created when the library opens. Use
**Settings → Buffers and session → Saved buffer library → Choose folder…** for an override, or
**Use default folder** to restore the portable default. Only an override is stored; the default is
resolved again on each launch. If the executable's directory is not writable, choose a writable folder
in Settings. Saved messages remain `.bxb` files in that folder.
