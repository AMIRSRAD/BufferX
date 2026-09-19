// Verifies the de-Qt'd IranSystem converter against the vectors asserted by the
// existing Qt test suite (tests/BufferXTests.cpp::testAtmEngineIranSystem).

#include <cstdio>
#include <string>
#include <vector>

#include "bufferx/IranSystem.h"
#include "bufferx/TextCodec.h"

namespace {

int failures = 0;

std::string toHex(const std::vector<unsigned char>& bytes) {
    static const char* digits = "0123456789ABCDEF";
    std::string out;
    for (unsigned char b : bytes) {
        out.push_back(digits[b >> 4]);
        out.push_back(digits[b & 0x0F]);
    }
    return out;
}

void check(bool condition, const std::string& label, const std::string& detail = {}) {
    std::printf("  [%s] %s%s\n", condition ? "PASS" : "FAIL", label.c_str(),
                detail.empty() ? "" : ("  -> " + detail).c_str());
    if (!condition) ++failures;
}

std::string utf8From(const std::vector<char32_t>& codepoints) {
    return textcodec::utf32ToUtf8(std::u32string(codepoints.begin(), codepoints.end()));
}

} // namespace

int main() {
    std::printf("=== ATM-engine IranSystem (vectors from BufferXTests.cpp) ===\n");

    // "سلام چطوری"
    const std::string phrase = utf8From({0x0633, 0x0644, 0x0627, 0x0645, 0x20,
                                         0x0686, 0x0637, 0x0648, 0x0631, 0x06CC});

    const iransystem::ConversionResult encoded = iransystem::fromUnicodeAtmEngine(phrase, true);
    check(encoded.ok, "fromUnicodeAtmEngine ok");
    check(toHex(encoded.bytes) == "FCA4F8AF9D20F4F2A8", "encoded bytes == FCA4F8AF9D20F4F2A8",
          toHex(encoded.bytes));

    const iransystem::ConversionResult decoded = iransystem::toAtmEngineUnicode(encoded.bytes);
    const std::u32string decodedU32 = textcodec::utf8ToUtf32(decoded.text);
    check(decoded.ok, "toAtmEngineUnicode ok");
    check(decodedU32.size() == encoded.bytes.size(), "decoded char count == byte count",
          std::to_string(decodedU32.size()) + " vs " + std::to_string(encoded.bytes.size()));
    check(decodedU32.size() > 7 && decodedU32[7] == 0x0644,
          "lam-alef historical decode preserved (index 7 == U+0644)");

    const iransystem::ConversionResult asciiDigits = iransystem::fromUnicodeAtmEngine("ATM 123", false);
    check(asciiDigits.ok && toHex(asciiDigits.bytes) == "41544D20313233",
          "digit toggle off leaves ASCII", toHex(asciiDigits.bytes));

    const iransystem::ConversionResult asciiDigitsOn = iransystem::fromUnicodeAtmEngine("ATM 123", true);
    check(asciiDigitsOn.ok && toHex(asciiDigitsOn.bytes) == "41544D20818283",
          "digit toggle on maps to Persian digits", toHex(asciiDigitsOn.bytes));

    std::printf("\n=== Normalized profile round trip (now works off-Windows) ===\n");
    const iransystem::ConversionResult fwd = iransystem::fromUnicode(phrase, false);
    check(fwd.ok, "fromUnicode ok", fwd.error);
    check(!fwd.bytes.empty(), "produced bytes", toHex(fwd.bytes));

    const iransystem::ConversionResult back = iransystem::toUnicode(fwd.bytes);
    check(back.ok, "toUnicode ok", back.error);
    std::printf("       round-trip text: %s\n", back.text.c_str());
    check(back.text == phrase, "normalized round trip preserves the phrase",
          back.text == phrase ? "" : ("got " + back.text + " want " + phrase));

    const iransystem::ConversionResult empty = iransystem::toUnicode({});
    check(empty.ok && empty.text.empty(), "empty input is ok and empty");

    // Digit-only input skips the byte-level reversal (isNumberOnly) but still
    // goes through the trailing run-reversal pass, so it comes back reversed.
    // That is the original behaviour and is asserted here to keep it pinned.
    const iransystem::ConversionResult digitsOnly = iransystem::toUnicode({'1', '2', '3'});
    check(digitsOnly.ok && digitsOnly.text == "321",
          "digit-only input reverses (original quirk preserved)", digitsOnly.text);

    std::printf("\n=== RESULT: %s (%d failures) ===\n", failures == 0 ? "ALL PASS" : "FAILURES", failures);
    return failures == 0 ? 0 : 1;
}
