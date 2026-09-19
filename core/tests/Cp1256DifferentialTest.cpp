// Differential check: portable CP1256 table vs the Win32 API it replaces.
// Every mismatch is printed so the table can be corrected.

#define NOMINMAX
#include <windows.h>

#include <cstdio>
#include <string>
#include <vector>

#include "bufferx/TextCodec.h"

namespace {

int decodeMismatches = 0;
int encodeMismatches = 0;
int encodeBestFitChecked = 0;

void checkDecode() {
    for (int b = 0; b < 256; ++b) {
        const unsigned char byte = static_cast<unsigned char>(b);
        const char raw = static_cast<char>(byte);

        wchar_t wide[8] = {};
        const int n = MultiByteToWideChar(1256, 0, &raw, 1, wide, 8);
        if (n <= 0) {
            std::printf("  decode 0x%02X: Win32 failed\n", b);
            ++decodeMismatches;
            continue;
        }

        const std::u32string ours = textcodec::cp1256ToUtf32({byte});
        if (ours.size() != 1) {
            std::printf("  decode 0x%02X: ours produced %zu chars\n", b, ours.size());
            ++decodeMismatches;
            continue;
        }
        if (static_cast<char32_t>(wide[0]) != ours[0]) {
            std::printf("  decode 0x%02X: win32=U+%04X ours=U+%04X\n", b,
                        static_cast<unsigned>(wide[0]), static_cast<unsigned>(ours[0]));
            ++decodeMismatches;
        }
    }
}

void checkEncodeRange(char32_t lo, char32_t hi, const char* label) {
    int localMismatch = 0;
    for (char32_t cp = lo; cp <= hi; ++cp) {
        if (cp >= 0xD800 && cp <= 0xDFFF) continue;

        const wchar_t wide[2] = {static_cast<wchar_t>(cp), 0};
        char narrow[8] = {};
        const int n = WideCharToMultiByte(1256, 0, wide, 1, narrow, 8, nullptr, nullptr);
        if (n != 1) continue; // multi-byte or failed; not represented as one byte

        const unsigned char win32Byte = static_cast<unsigned char>(narrow[0]);

        std::u32string text;
        text.push_back(cp);
        const std::vector<unsigned char> ours = textcodec::utf32ToCp1256(text);
        if (ours.size() != 1) {
            std::printf("  encode U+%04X (%s): ours produced %zu bytes\n",
                        static_cast<unsigned>(cp), label, ours.size());
            ++encodeMismatches;
            continue;
        }

        ++encodeBestFitChecked;
        if (ours[0] != win32Byte) {
            if (localMismatch < 40) {
                std::printf("  encode U+%04X (%s): win32=0x%02X ours=0x%02X\n",
                            static_cast<unsigned>(cp), label, win32Byte, ours[0]);
            }
            ++localMismatch;
            ++encodeMismatches;
        }
    }
    if (localMismatch > 40) {
        std::printf("  ... %d more mismatches in %s\n", localMismatch - 40, label);
    }
}

void checkRoundTripOfAppTables() {
    // The exact string the IranSystem converter encodes to build its
    // "final letter" set. This must match Win32 byte-for-byte or shaping breaks.
    const char* singlesUtf8 = "\xd8\xa1\xd8\xa2\xd8\xa3\xd8\xa4\xd8\xa5\xd8\xa7"
                              "\xd8\xaf\xd8\xb0\xd8\xb1\xd8\xb2\xda\x98\xd9\x88";
    const std::vector<unsigned char> ours = textcodec::utf8ToCp1256(singlesUtf8);

    const std::u32string u32 = textcodec::utf8ToUtf32(singlesUtf8);
    std::wstring wide;
    for (char32_t c : u32) wide.push_back(static_cast<wchar_t>(c));
    std::string win32(64, '\0');
    const int n = WideCharToMultiByte(1256, 0, wide.c_str(), static_cast<int>(wide.size()),
                                      win32.data(), 64, nullptr, nullptr);
    win32.resize(n > 0 ? n : 0);

    std::printf("\n  singles set: ours=[");
    for (unsigned char b : ours) std::printf("%d ", b);
    std::printf("]\n  singles set: win32=[");
    for (char c : win32) std::printf("%d ", static_cast<unsigned char>(c));
    std::printf("]\n");

    bool same = ours.size() == win32.size();
    if (same) {
        for (size_t i = 0; i < ours.size(); ++i) {
            if (ours[i] != static_cast<unsigned char>(win32[i])) same = false;
        }
    }
    std::printf("  singles set match: %s\n", same ? "YES" : "NO -- SHAPING WOULD BREAK");
    if (!same) ++encodeMismatches;
}

} // namespace

namespace {

int ebcdicMismatches = 0;

void check(bool condition, const std::string& label, const std::string& detail = {}) {
    std::printf("  [%s] %s%s\n", condition ? "PASS" : "FAIL", label.c_str(),
                detail.empty() ? "" : ("  -> " + detail).c_str());
    if (!condition) ++ebcdicMismatches;
}

// The EBCDIC path replaced Win32 code pages 37 and 20127; verify it the same
// way, against the API it replaced.
void checkEbcdic() {
    int mismatches = 0;

    for (int b = 0; b < 256; ++b) {
        const std::vector<unsigned char> bytes{static_cast<unsigned char>(b)};
        const std::string ours = textcodec::ebcdic037ToUtf8(bytes);

        const char raw = static_cast<char>(b);
        wchar_t wide[4] = {};
        const int n = MultiByteToWideChar(37, 0, &raw, 1, wide, 4);
        if (n != 1) continue;
        char utf8[8] = {};
        const int m = WideCharToMultiByte(CP_UTF8, 0, wide, 1, utf8, 8, nullptr, nullptr);
        const std::string win32(utf8, m > 0 ? static_cast<size_t>(m) : 0);

        if (ours != win32) {
            if (mismatches < 10) {
                std::printf("  ebcdic->utf8 0x%02X: win32=%zu bytes ours=%zu bytes\n", b, win32.size(),
                            ours.size());
            }
            ++mismatches;
        }
    }
    check(mismatches == 0, "EBCDIC 037 -> UTF-8 matches Win32 for all 256 bytes",
          std::to_string(mismatches) + " mismatches");

    // ASCII -> EBCDIC, with best-fit disabled, exactly as the original did.
    int encodeMismatches = 0;
    for (int c = 0; c < 128; ++c) {
        const std::string ascii(1, static_cast<char>(c));
        std::vector<unsigned char> ours;
        const bool ok = textcodec::asciiToEbcdic037(ascii, ours);

        const wchar_t wide[2] = {static_cast<wchar_t>(c), 0};
        char narrow[4] = {};
        BOOL usedDefault = FALSE;
        const int n =
            WideCharToMultiByte(37, WC_NO_BEST_FIT_CHARS, wide, 1, narrow, 4, nullptr, &usedDefault);
        if (n != 1) continue;

        const unsigned char expected =
            usedDefault ? 0x6F : static_cast<unsigned char>(narrow[0]);
        if (!ok || ours.size() != 1 || ours[0] != expected) {
            if (encodeMismatches < 10) {
                std::printf("  ascii->ebcdic 0x%02X: win32=0x%02X ours=0x%02X\n", c, expected,
                            ours.empty() ? 0 : ours[0]);
            }
            ++encodeMismatches;
        }
    }
    check(encodeMismatches == 0, "ASCII -> EBCDIC 037 matches Win32 for all 128 characters",
          std::to_string(encodeMismatches) + " mismatches");

    // The vector the previous Qt suite asserted.
    std::vector<unsigned char> a;
    check(textcodec::asciiToEbcdic037("A", a) && a.size() == 1 && a[0] == 0xC1,
          "'A' encodes to EBCDIC 0xC1 (vector from the Qt suite)");
    check(textcodec::ebcdic037ToUtf8({0xC1}) == "A", "EBCDIC 0xC1 decodes to 'A'");

    // Non-ASCII input must be refused rather than approximated.
    std::vector<unsigned char> rejected;
    check(!textcodec::asciiToEbcdic037("caf\xC3\xA9", rejected),
          "non-ASCII input is rejected, not best-fitted");
}

} // namespace

int main() {
    std::printf("=== CP1256 decode (all 256 bytes) ===\n");
    checkDecode();
    std::printf("  decode mismatches: %d\n", decodeMismatches);

    std::printf("\n=== CP1256 encode ===\n");
    checkEncodeRange(0x0000, 0x00FF, "latin1");
    checkEncodeRange(0x0600, 0x06FF, "arabic");
    checkEncodeRange(0x2000, 0x20FF, "punctuation");
    checkEncodeRange(0x0150, 0x0199, "latin-ext");
    checkEncodeRange(0xFB50, 0xFDFF, "arabic-presentation-A");
    checkEncodeRange(0xFE70, 0xFEFF, "arabic-presentation-B");
    std::printf("  encode codepoints checked: %d\n", encodeBestFitChecked);
    std::printf("  encode mismatches: %d\n", encodeMismatches);

    checkRoundTripOfAppTables();

    std::printf("\n=== EBCDIC code page 037 ===\n");
    checkEbcdic();

    const bool identical = decodeMismatches == 0 && encodeMismatches == 0 && ebcdicMismatches == 0;
    std::printf("\n=== RESULT: %s ===\n", identical ? "IDENTICAL" : "DIFFERENCES FOUND");
    return identical ? 0 : 1;
}
