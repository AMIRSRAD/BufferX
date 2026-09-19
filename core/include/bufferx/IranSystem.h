#pragma once

// IranSystem is a legacy Iranian banking character encoding used by ATM and
// POS host software. Text is stored right-to-left in presentation order with
// per-position letter shaping already applied, so conversion is not a simple
// code-page mapping -- it has to undo (or apply) Persian joining behaviour.
//
// Strings crossing this API are UTF-8. Shaping works internally in UTF-32
// because it indexes text one character at a time.

#include <string>
#include <vector>

namespace iransystem {

struct ConversionResult {
    bool ok = false;
    std::string error;
    std::string text;
    std::vector<unsigned char> bytes;
};

// Normalized profile: round-trips cleanly and is the sensible default.
ConversionResult toUnicode(const std::vector<unsigned char>& bytes);
ConversionResult fromUnicode(const std::string& text, bool convertNumbers);
ConversionResult toUnicodeFromText(const std::string& iranSystemText);
ConversionResult fromUnicodeToText(const std::string& text, bool convertNumbers);

// ATM-engine profile: byte-compatible with the AlmasPlus W2IS/ToIranSystem
// implementation, including its quirks. Use when talking to a legacy host.
ConversionResult toAtmEngineUnicode(const std::vector<unsigned char>& inputBytes);
ConversionResult fromUnicodeAtmEngine(const std::string& text, bool convertNumbers);

} // namespace iransystem
