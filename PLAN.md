# BufferX Task Plan

## Goal

Bring BufferX from a functional prototype to a reliable ISO 8583 tool with clearer protocol coverage, safer parsing, and test protection.

## Task 1: Add Test Coverage

- Create unit tests for `Hex`, `Packager`, `PackagerLoader`, and `Iso8583Codec`.
- Add encode/decode round-trip tests for representative packagers such as `SLM`, `SLMLink`, and one non-standard table packager.
- Add failure-case tests for malformed hex, invalid length headers, missing field definitions, and truncated buffers.
- Add save/load buffer file tests for JSON persistence behavior.
- Wire tests into CMake so they run through a normal build/test flow.

## Task 2: Replace Regex-Based XML Parsing

- Replace the regex parser in [src/PackagerLoader.cpp](C:\Users\a.saberi\CLionProjects\BufferX\src\PackagerLoader.cpp:43) with a real XML parser from Qt.
- Preserve current packager attributes and field extraction behavior.
- Add validation for missing required attributes and invalid integer values.
- Improve parse errors so the user can see which packager or field entry is malformed.

## Task 3: Expand Packager Field Type Support

- Add internal support for currently unmapped XML field types such as `IFA_HHHHCHAR`, `IFA_LLLLCHAR`, `IFA_LLLLLLCHAR`, and `IFA_LLLLBINARY`.
- Review all field types present in [data/packagers.xml](C:\Users\a.saberi\CLionProjects\BufferX\data\packagers.xml:1) and make the mapping explicit.
- Decide which types are truly supported, partially supported, or intentionally rejected.
- Return clear errors for unsupported types instead of silently treating them as `Unknown`.

## Task 4: Implement Real Numeric Validation

- Enforce digit-only validation for numeric field types during encode.
- Implement `allowNumericSanitize` in [src/Iso8583.cpp](C:\Users\a.saberi\CLionProjects\BufferX\src\Iso8583.cpp:425) so the QML dialog path does real work.
- Add tests covering strict rejection and sanitize-enabled behavior.
- Make error messages identify the exact field that failed validation.

## Task 5: Honor Packager Metadata in the Codec

- Review how `BitmapIndex`, `SecondPartBitmap`, `FieldCount`, `LenFormat`, `MacMethod`, and `MacSize` are supposed to affect message layout.
- Remove assumptions in the codec that every message is `MTI + ASCII-hex bitmap + fields`.
- Support packagers with `BitmapIndex="-1"` and other table/subfield layouts where applicable.
- Define which metadata is required for decode and encode, and fail explicitly when a packager definition is incompatible with the current codec.

## Task 6: Clarify Binary and BCD Semantics

- Distinguish ASCII numeric, binary, BCD, and hex-encoded-on-the-wire behavior in the internal type model.
- Revisit mappings like `IFB_LLNUM_BCD` and `IFB_LLNUM_PAN_HC`, which are currently treated as text-style LLNUM.
- Decide whether binary-oriented packagers should emit true binary bytes or continue using ASCII hex wire encoding.
- Document the chosen wire format rules and apply them consistently in both decode and encode.

## Task 7: Add MAC Handling

- Define how MAC fields should be encoded, excluded from MAC input, or verified on decode.
- Use `MacMethod` and `MacSize` from the packager where applicable.
- If MAC computation is out of scope, explicitly mark it unsupported in the UI and backend responses instead of implying support through metadata.

## Task 8: Improve Decode and Encode Errors

- Include field id, byte offset, expected length, remaining bytes, and a short raw context snippet in codec errors.
- Differentiate user input errors from internal packager-definition problems.
- Standardize backend JSON error payloads so the UI can react predictably.

## Task 9: Expose Buffer File Workflow in the UI

- Add visible UI actions for opening and saving buffer JSON files using the existing backend methods.
- Show the current buffer file name or path in the interface.
- Support switching between saved buffers if multi-buffer behavior is intended.
- Verify that load restores packager, header settings, raw mode, and field values correctly.

## Task 10: Add Project Documentation

- Add a `README.md` that explains what BufferX does, how to build it, and what message formats it currently supports.
- Document the packager XML format and any constraints the codec expects.
- Call out current limitations clearly, especially around binary fields, non-standard packagers, and MAC behavior.
- Add a short contributor section describing where core logic lives and how to run tests.

## Suggested Order

1. Add tests first.
2. Replace XML parsing and expand field type support.
3. Fix numeric validation and binary/BCD semantics.
4. Rework codec assumptions around packager metadata.
5. Add MAC handling, UI workflow improvements, and documentation.

## Completion Criteria

- Supported packager types are explicit and tested.
- Encode/decode behavior is deterministic for supported formats.
- Unsupported formats fail loudly with actionable errors.
- The UI exposes the main workflows already present in the backend.
- The repository has enough tests and documentation to change the codec safely.
