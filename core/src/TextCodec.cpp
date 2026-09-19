#include "bufferx/TextCodec.h"

#include <array>
#include <unordered_map>

namespace textcodec {
namespace {

// Windows-1256 (Arabic) to Unicode. Index is the byte value minus 0x80;
// bytes 0x00-0x7F are ASCII and map to themselves.
constexpr std::array<char32_t, 128> kCp1256HighToUnicode = {
    0x20AC, 0x067E, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, // 0x80
    0x02C6, 0x2030, 0x0679, 0x2039, 0x0152, 0x0686, 0x0698, 0x0688, // 0x88
    0x06AF, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, // 0x90
    0x06A9, 0x2122, 0x0691, 0x203A, 0x0153, 0x200C, 0x200D, 0x06BA, // 0x98
    0x00A0, 0x060C, 0x00A2, 0x00A3, 0x00A4, 0x00A5, 0x00A6, 0x00A7, // 0xA0
    0x00A8, 0x00A9, 0x06BE, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x00AF, // 0xA8
    0x00B0, 0x00B1, 0x00B2, 0x00B3, 0x00B4, 0x00B5, 0x00B6, 0x00B7, // 0xB0
    0x00B8, 0x00B9, 0x061B, 0x00BB, 0x00BC, 0x00BD, 0x00BE, 0x061F, // 0xB8
    0x06C1, 0x0621, 0x0622, 0x0623, 0x0624, 0x0625, 0x0626, 0x0627, // 0xC0
    0x0628, 0x0629, 0x062A, 0x062B, 0x062C, 0x062D, 0x062E, 0x062F, // 0xC8
    0x0630, 0x0631, 0x0632, 0x0633, 0x0634, 0x0635, 0x0636, 0x00D7, // 0xD0
    0x0637, 0x0638, 0x0639, 0x063A, 0x0640, 0x0641, 0x0642, 0x0643, // 0xD8
    0x00E0, 0x0644, 0x00E2, 0x0645, 0x0646, 0x0647, 0x0648, 0x00E7, // 0xE0
    0x00E8, 0x00E9, 0x00EA, 0x00EB, 0x0649, 0x064A, 0x00EE, 0x00EF, // 0xE8
    0x064B, 0x064C, 0x064D, 0x064E, 0x00F4, 0x064F, 0x0650, 0x00F7, // 0xF0
    0x0651, 0x00F9, 0x0652, 0x00FB, 0x00FC, 0x200E, 0x200F, 0x06D2, // 0xF8
};

struct Cp1256EncodeEntry {
    char32_t codepoint;
    unsigned char byte;
};

// The encode direction is not simply the reverse of the decode table: Windows
// applies best-fit substitutions (accented capitals to bare ASCII, Arabic
// presentation forms to base letters, typographic dashes to '-'). Those
// substitutions are part of the behaviour the previous implementation had, so
// the table is generated from Win32 rather than hand-written.
#include "Cp1256Table.inc"

#include "Cp037Table.inc"

const std::unordered_map<char32_t, unsigned char>& encodeTable() {
    static const std::unordered_map<char32_t, unsigned char> table = [] {
        std::unordered_map<char32_t, unsigned char> map;
        map.reserve(sizeof(kCp1256EncodeHigh) / sizeof(kCp1256EncodeHigh[0]) + 128);
        for (char32_t c = 0; c < 0x80; ++c) {
            map.emplace(c, static_cast<unsigned char>(c));
        }
        for (const Cp1256EncodeEntry& entry : kCp1256EncodeHigh) {
            map.emplace(entry.codepoint, entry.byte);
        }
        return map;
    }();
    return table;
}

} // namespace

std::u32string utf8ToUtf32(const std::string& utf8) {
    std::u32string out;
    out.reserve(utf8.size());

    std::size_t i = 0;
    const std::size_t size = utf8.size();
    while (i < size) {
        const unsigned char lead = static_cast<unsigned char>(utf8[i]);
        char32_t codepoint = 0;
        std::size_t extra = 0;

        if (lead < 0x80) {
            codepoint = lead;
        } else if ((lead & 0xE0) == 0xC0) {
            codepoint = lead & 0x1F;
            extra = 1;
        } else if ((lead & 0xF0) == 0xE0) {
            codepoint = lead & 0x0F;
            extra = 2;
        } else if ((lead & 0xF8) == 0xF0) {
            codepoint = lead & 0x07;
            extra = 3;
        } else {
            out.push_back(kReplacementCharacter);
            ++i;
            continue;
        }

        if (i + extra >= size) {
            out.push_back(kReplacementCharacter);
            break;
        }

        bool valid = true;
        for (std::size_t k = 1; k <= extra; ++k) {
            const unsigned char continuation = static_cast<unsigned char>(utf8[i + k]);
            if ((continuation & 0xC0) != 0x80) {
                valid = false;
                break;
            }
            codepoint = (codepoint << 6) | (continuation & 0x3F);
        }

        if (!valid) {
            out.push_back(kReplacementCharacter);
            ++i;
            continue;
        }

        // Reject overlong forms, surrogates, and out-of-range values so that
        // malformed input cannot smuggle through as a valid codepoint.
        const bool overlong = (extra == 1 && codepoint < 0x80) ||
                              (extra == 2 && codepoint < 0x800) ||
                              (extra == 3 && codepoint < 0x10000);
        const bool surrogate = codepoint >= 0xD800 && codepoint <= 0xDFFF;
        if (overlong || surrogate || codepoint > 0x10FFFF) {
            out.push_back(kReplacementCharacter);
        } else {
            out.push_back(codepoint);
        }
        i += extra + 1;
    }

    return out;
}

std::string utf32ToUtf8(const std::u32string& utf32) {
    std::string out;
    out.reserve(utf32.size());

    for (char32_t codepoint : utf32) {
        if (codepoint > 0x10FFFF || (codepoint >= 0xD800 && codepoint <= 0xDFFF)) {
            codepoint = kReplacementCharacter;
        }
        if (codepoint < 0x80) {
            out.push_back(static_cast<char>(codepoint));
        } else if (codepoint < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (codepoint >> 6)));
            out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
        } else if (codepoint < 0x10000) {
            out.push_back(static_cast<char>(0xE0 | (codepoint >> 12)));
            out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xF0 | (codepoint >> 18)));
            out.push_back(static_cast<char>(0x80 | ((codepoint >> 12) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
        }
    }

    return out;
}

std::u32string cp1256ToUtf32(const std::vector<unsigned char>& bytes) {
    std::u32string out;
    out.reserve(bytes.size());
    for (const unsigned char byte : bytes) {
        out.push_back(byte < 0x80 ? static_cast<char32_t>(byte)
                                  : kCp1256HighToUnicode[byte - 0x80]);
    }
    return out;
}

std::string cp1256ToUtf8(const std::vector<unsigned char>& bytes) {
    return utf32ToUtf8(cp1256ToUtf32(bytes));
}

std::vector<unsigned char> utf32ToCp1256(const std::u32string& text) {
    const auto& table = encodeTable();

    std::vector<unsigned char> out;
    out.reserve(text.size());
    for (const char32_t codepoint : text) {
        const auto hit = table.find(codepoint);
        out.push_back(hit != table.end() ? hit->second : kUnmappableByte);
    }
    return out;
}

std::vector<unsigned char> utf8ToCp1256(const std::string& text) {
    return utf32ToCp1256(utf8ToUtf32(text));
}

bool asciiToEbcdic037(const std::string& ascii, std::vector<unsigned char>& out) {
    out.clear();
    out.reserve(ascii.size());
    for (const char c : ascii) {
        const unsigned char byte = static_cast<unsigned char>(c);
        if (byte >= 0x80) {
            out.clear();
            return false;
        }
        out.push_back(kAsciiToEbcdic037[byte]);
    }
    return true;
}

std::string ebcdic037ToUtf8(const std::vector<unsigned char>& bytes) {
    std::u32string text;
    text.reserve(bytes.size());
    for (const unsigned char byte : bytes) {
        text.push_back(kEbcdic037ToUnicode[byte]);
    }
    return utf32ToUtf8(text);
}

bool hasDirectCp1256Encoding(char32_t codepoint) {
    // "Direct" means the codepoint survives a round trip. Best-fit entries
    // encode successfully but decode back to something else, so they are
    // reported as indirect.
    const auto& table = encodeTable();
    const auto hit = table.find(codepoint);
    if (hit == table.end()) {
        return false;
    }
    const unsigned char byte = hit->second;
    const char32_t decoded =
        byte < 0x80 ? static_cast<char32_t>(byte) : kCp1256HighToUnicode[byte - 0x80];
    return decoded == codepoint;
}

bool isWhitespace(char32_t codepoint) {
    // Matches the set QString::trimmed() removes.
    return codepoint == U' ' || codepoint == U'\t' || codepoint == U'\n' ||
           codepoint == U'\r' || codepoint == U'\f' || codepoint == U'\v';
}

std::u32string trimWhitespace(const std::u32string& text) {
    std::size_t begin = 0;
    std::size_t end = text.size();
    while (begin < end && isWhitespace(text[begin])) {
        ++begin;
    }
    while (end > begin && isWhitespace(text[end - 1])) {
        --end;
    }
    return text.substr(begin, end - begin);
}

std::string trimWhitespaceUtf8(const std::string& text) {
    return utf32ToUtf8(trimWhitespace(utf8ToUtf32(text)));
}

} // namespace textcodec
