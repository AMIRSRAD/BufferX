// Emits the EBCDIC (code page 037) tables by asking Win32 directly, so the
// portable implementation reproduces the Windows-only original exactly.
//
// Build and run on Windows:
//     cl /std:c++17 /EHsc scripts\generate_cp037_table.cpp && generate_cp037_table.exe

#define NOMINMAX
#include <windows.h>

#include <cstdio>

int main() {
    // EBCDIC byte -> Unicode. Every byte in CP037 has a mapping.
    std::printf("static constexpr char32_t kEbcdic037ToUnicode[256] = {\n");
    for (int b = 0; b < 256; ++b) {
        if (b % 8 == 0) std::printf("    ");
        const char raw = static_cast<char>(b);
        wchar_t wide[4] = {};
        const int n = MultiByteToWideChar(37, 0, &raw, 1, wide, 4);
        const unsigned cp = (n == 1) ? static_cast<unsigned>(wide[0]) : 0xFFFD;
        std::printf("0x%04X,", cp);
        std::printf((b % 8 == 7) ? "\n" : " ");
    }
    std::printf("};\n\n");

    // ASCII -> EBCDIC, with best-fit disabled exactly as the original did.
    std::printf("static constexpr unsigned char kAsciiToEbcdic037[128] = {\n");
    for (int c = 0; c < 128; ++c) {
        if (c % 8 == 0) std::printf("    ");
        const wchar_t wide[2] = {static_cast<wchar_t>(c), 0};
        char narrow[4] = {};
        BOOL usedDefault = FALSE;
        const int n = WideCharToMultiByte(37, WC_NO_BEST_FIT_CHARS, wide, 1, narrow, 4, nullptr, &usedDefault);
        const unsigned char byte =
            (n == 1 && !usedDefault) ? static_cast<unsigned char>(narrow[0]) : 0x6F; // 0x6F is EBCDIC '?'
        std::printf("0x%02X,", byte);
        std::printf((c % 8 == 7) ? "\n" : " ");
    }
    std::printf("};\n");
    return 0;
}
