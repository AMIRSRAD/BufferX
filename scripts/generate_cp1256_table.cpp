// Emits the complete Windows-1256 encode table by asking Win32 directly, so the
// portable codec reproduces MultiByteToWideChar/WideCharToMultiByte exactly
// rather than relying on hand-written guesses.

#define NOMINMAX
#include <windows.h>

#include <cstdio>
#include <vector>

int main() {
    struct Entry {
        unsigned cp;
        unsigned char byte;
    };
    std::vector<Entry> entries;

    for (unsigned cp = 0; cp <= 0xFFFF; ++cp) {
        if (cp >= 0xD800 && cp <= 0xDFFF) continue;
        if (cp < 0x80) continue;

        const wchar_t wide[2] = {static_cast<wchar_t>(cp), 0};
        char narrow[8] = {};
        BOOL usedDefault = FALSE;
        const int n = WideCharToMultiByte(1256, 0, wide, 1, narrow, 8, nullptr, &usedDefault);
        if (n != 1) continue;
        // usedDefault marks codepoints Win32 could not represent at all; those
        // collapse to '?' and are handled by the fallback, not the table.
        if (usedDefault) continue;

        entries.push_back({cp, static_cast<unsigned char>(narrow[0])});
    }

    std::printf("// %zu entries\n", entries.size());
    int perLine = 0;
    for (const Entry& e : entries) {
        if (perLine == 0) std::printf("    ");
        std::printf("{0x%04X, 0x%02X},", e.cp, e.byte);
        if (++perLine == 6) {
            std::printf("\n");
            perLine = 0;
        } else {
            std::printf(" ");
        }
    }
    if (perLine != 0) std::printf("\n");
    return 0;
}

