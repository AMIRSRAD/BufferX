#include "bufferx/IranSystem.h"

#include "bufferx/TextCodec.h"

#include <algorithm>
#include <array>
#include <unordered_map>

namespace iransystem {

namespace {

using textcodec::utf32ToUtf8;
using textcodec::utf8ToUtf32;

constexpr unsigned char kAlefChasban = 145;
constexpr unsigned char kLaaArabic = 242;
constexpr unsigned char kLaamAvval = 243;
constexpr unsigned char kQuestionMark = 191;

// Letters that never join to the following character. Encoded as codepoints
// rather than a source literal so the table cannot be corrupted by the
// compiler's source-charset assumptions.
//   ء آ أ ؤ إ ا د ذ ر ز ژ و
constexpr std::array<char32_t, 12> kNonJoiningLetters = {
    0x0621, 0x0622, 0x0623, 0x0624, 0x0625, 0x0627,
    0x062F, 0x0630, 0x0631, 0x0632, 0x0698, 0x0648,
};

const std::unordered_map<unsigned char, unsigned char> kIranTo1256 = {
    {128, 48},  {129, 49},  {130, 50},  {131, 51},  {132, 52},  {133, 53},  {134, 54},  {135, 55},
    {136, 56},  {137, 57},  {138, 161}, {139, 220}, {140, 191}, {141, 194}, {142, 196}, {143, 154},
    {144, 199}, {145, 199}, {146, 200}, {147, 200}, {148, 129}, {149, 129}, {150, 202}, {151, 202},
    {152, 203}, {153, 203}, {154, 204}, {155, 204}, {156, 141}, {157, 141}, {158, 205}, {159, 205},
    {160, 206}, {161, 206}, {162, 207}, {163, 208}, {164, 209}, {165, 210}, {166, 142}, {167, 211},
    {168, 211}, {169, 212}, {170, 212}, {171, 213}, {172, 213}, {173, 214}, {174, 214}, {175, 216},
    {224, 217}, {225, 218}, {226, 218}, {227, 218}, {228, 218}, {229, 219}, {230, 219}, {231, 219},
    {232, 219}, {233, 221}, {234, 221}, {235, 222}, {236, 222}, {237, 152}, {238, 152}, {239, 144},
    {240, 144}, {241, 225}, {242, 225}, {243, 225}, {244, 227}, {245, 227}, {246, 228}, {247, 228},
    {248, 230}, {249, 229}, {250, 229}, {251, 170}, {252, 236}, {253, 237}, {254, 237}, {255, 160},
};

const std::unordered_map<unsigned char, unsigned char> kMapperCharIsNotFinal = {
    {48, 128},  {49, 129},  {50, 130},  {51, 131},  {52, 132},  {53, 133},  {54, 134},  {55, 135},
    {56, 136},  {57, 137},  {129, 149}, {141, 157}, {142, 166}, {144, 240}, {152, 238}, {161, 138},
    {191, 140}, {193, 143}, {194, 141}, {195, 145}, {196, 142}, {197, 145}, {198, 254}, {199, 145},
    {200, 147}, {201, 250}, {202, 151}, {203, 153}, {204, 155}, {205, 159}, {206, 161}, {207, 162},
    {208, 163}, {209, 164}, {210, 165}, {211, 168}, {212, 170}, {213, 172}, {214, 174}, {216, 175},
    {217, 224}, {218, 227}, {219, 231}, {220, 139}, {221, 234}, {222, 236}, {223, 238}, {225, 243},
    {227, 245}, {228, 247}, {229, 250}, {230, 248}, {236, 254}, {237, 254},
};

const std::unordered_map<unsigned char, unsigned char> kMapperNextCharFinal = {
    {129, 148}, {141, 156}, {144, 239}, {152, 237}, {198, 252}, {200, 146}, {201, 249}, {202, 150},
    {203, 152}, {204, 154}, {205, 158}, {206, 160}, {211, 167}, {212, 169}, {213, 171}, {214, 173},
    {218, 226}, {219, 230}, {221, 233}, {222, 235}, {223, 237}, {225, 241}, {227, 244}, {228, 246},
    {229, 249}, {236, 252}, {237, 252},
};

const std::unordered_map<unsigned char, unsigned char> kMapperPreviousCharFinal = {
    {170, 251}, {195, 144}, {197, 144}, {199, 144}, {201, 251}, {218, 228}, {219, 232}, {229, 251},
};

const std::unordered_map<unsigned char, unsigned char> kMapperPreviousCharNextCharFinal = {
    {129, 148}, {141, 156}, {144, 239}, {152, 237}, {195, 144}, {197, 144}, {199, 144}, {200, 146},
    {201, 249}, {202, 150}, {203, 152}, {204, 154}, {205, 158}, {206, 160}, {211, 167}, {212, 169},
    {213, 171}, {214, 173}, {218, 225}, {219, 229}, {221, 233}, {222, 235}, {223, 237}, {225, 241},
    {227, 244}, {228, 246}, {229, 249}, {236, 252}, {237, 253},
};

bool isAsciiDigit(unsigned char value) {
    return value >= '0' && value <= '9';
}

bool isNumberOnly(const std::vector<unsigned char>& bytes) {
    return !bytes.empty() &&
           std::all_of(bytes.begin(), bytes.end(), [](unsigned char value) { return isAsciiDigit(value); });
}

bool isLatinLetter(unsigned char value) {
    return value < 128 && value > 31;
}

bool isWhitespaceLetter(unsigned char value) {
    return value == 0 || value == 8 || value == 9 || value == 10 || value == 13 || value == 27 || value == 32;
}

bool isWhitespaceOrLatinOrQuestionMark(unsigned char value) {
    return isWhitespaceLetter(value) || isLatinLetter(value) || value == kQuestionMark;
}

unsigned char mirroredCharacter(unsigned char value) {
    switch (value) {
    case '(':
        return ')';
    case ')':
        return '(';
    case '[':
        return ']';
    case ']':
        return '[';
    case '{':
        return '}';
    case '}':
        return '{';
    default:
        return value;
    }
}

unsigned char latinLetterToIranSystem(unsigned char value) {
    return isAsciiDigit(value) ? static_cast<unsigned char>(value + 80) : mirroredCharacter(value);
}

bool isAsciiAlphanumeric(char32_t c) {
    return (c >= U'A' && c <= U'Z') || (c >= U'a' && c <= U'z') || (c >= U'0' && c <= U'9');
}

// Runs of Latin letters and digits are stored in visual order inside otherwise
// right-to-left text, so each run is reversed independently. Replaces the
// previous QRegularExpression("[A-Za-z0-9]+") pass.
std::u32string reverseNumbersAndLetters(const std::u32string& text) {
    std::u32string result;
    result.reserve(text.size());

    std::size_t i = 0;
    while (i < text.size()) {
        if (!isAsciiAlphanumeric(text[i])) {
            result.push_back(text[i]);
            ++i;
            continue;
        }
        const std::size_t start = i;
        while (i < text.size() && isAsciiAlphanumeric(text[i])) {
            ++i;
        }
        for (std::size_t cursor = i; cursor-- > start;) {
            result.push_back(text[cursor]);
        }
    }

    return textcodec::trimWhitespace(result);
}

// IranSystem output is normalized to the Persian forms of Yeh and Kaf.
std::u32string normalizePersianOutput(std::u32string text) {
    for (char32_t& c : text) {
        if (c == 0x064A || c == 0x0649) {
            c = 0x06CC;
        } else if (c == 0x0643) {
            c = 0x06A9;
        }
    }
    return text;
}

struct NumberExtraction {
    std::vector<unsigned char> masked;
    std::vector<std::string> numbers;
};

struct EngineCharMapEntry {
    bool connectPrev;
    bool connectNext;
    unsigned char single;
    unsigned char previous;
    unsigned char next;
    unsigned char both;
};

const std::unordered_map<char32_t, EngineCharMapEntry> kAtmEngineCharMap = {
    {0x20, {false, false, 0x20, 0, 0, 0}}, {0x3A, {false, false, 0x3A, 0, 0, 0}},
    {0x30, {false, false, 0x80, 0, 0, 0}}, {0x31, {false, false, 0x81, 0, 0, 0}},
    {0x32, {false, false, 0x82, 0, 0, 0}}, {0x33, {false, false, 0x83, 0, 0, 0}},
    {0x34, {false, false, 0x84, 0, 0, 0}}, {0x35, {false, false, 0x85, 0, 0, 0}},
    {0x36, {false, false, 0x86, 0, 0, 0}}, {0x37, {false, false, 0x87, 0, 0, 0}},
    {0x38, {false, false, 0x88, 0, 0, 0}}, {0x39, {false, false, 0x89, 0, 0, 0}},
    {0x061F, {false, false, 0x8C, 0, 0, 0}}, {0x0622, {false, false, 0x8D, 0, 0, 0}},
    {0x0621, {false, false, 0x8F, 0, 0, 0}}, {0x0627, {true, false, 0x90, 0x91, 0, 0}},
    {0x0628, {true, true, 0x92, 0x92, 0x93, 0x93}}, {0x067E, {true, true, 0x94, 0x94, 0x95, 0x95}},
    {0x062A, {true, true, 0x96, 0x96, 0x97, 0x97}}, {0x062B, {true, true, 0x98, 0x98, 0x99, 0x99}},
    {0x062C, {true, true, 0x9A, 0x9A, 0x9B, 0x9B}}, {0x0686, {true, true, 0x9C, 0x9C, 0x9D, 0x9D}},
    {0x062D, {true, true, 0x9E, 0x9E, 0x9F, 0x9F}}, {0x062E, {true, true, 0xA0, 0xA0, 0xA1, 0xA1}},
    {0x062F, {true, false, 0xA2, 0xA2, 0, 0}}, {0x0630, {true, false, 0xA3, 0xA3, 0, 0}},
    {0x0631, {true, false, 0xA4, 0xA4, 0, 0}}, {0x0632, {true, false, 0xA5, 0xA5, 0, 0}},
    {0x0698, {true, false, 0xA6, 0xA6, 0, 0}}, {0x0633, {true, true, 0xA7, 0xA7, 0xA8, 0xA8}},
    {0x0634, {true, true, 0xA9, 0xA9, 0xAA, 0xAA}}, {0x0635, {true, true, 0xAB, 0xAB, 0xAC, 0xAC}},
    {0x0636, {true, true, 0xAD, 0xAD, 0xAE, 0xAE}}, {0x0637, {true, true, 0xAF, 0xAF, 0xAF, 0xAF}},
    {0x0638, {true, true, 0xE0, 0xE0, 0xE0, 0xE0}}, {0x0639, {true, true, 0xE1, 0xE2, 0xE4, 0xE3}},
    {0x063A, {true, true, 0xE5, 0xE6, 0xE8, 0xE7}}, {0x200C, {true, true, 0xE5, 0xE6, 0xE8, 0xE7}},
    {0x0641, {true, true, 0xE9, 0xE9, 0xEA, 0xEA}}, {0x0642, {true, true, 0xEB, 0xEB, 0xEC, 0xEC}},
    {0x06A9, {true, true, 0xED, 0xED, 0xEE, 0xEE}}, {0x06AF, {true, true, 0xEF, 0xEF, 0xF0, 0xF0}},
    {0x0644, {true, true, 0xF1, 0xF1, 0xF3, 0xF3}}, {0x0645, {true, true, 0xF4, 0xF4, 0xF5, 0xF5}},
    {0x0646, {true, true, 0xF6, 0xF6, 0xF7, 0xF7}}, {0x0648, {true, false, 0xF8, 0xF8, 0, 0}},
    {0x0647, {true, true, 0xF9, 0xF9, 0xFB, 0xFA}}, {0x06CC, {true, true, 0xFC, 0xFC, 0xFE, 0xFE}},
    {0x064A, {true, true, 0xFC, 0xFC, 0xFE, 0xFE}}, {0x0649, {true, true, 0xFC, 0xFC, 0xFE, 0xFE}},
};

char32_t atmEngineIranSystemChar(unsigned char value) {
    if (value < 0x80) return static_cast<char32_t>(value);
    if (value <= 0x89) return static_cast<char32_t>(0x06F0 + value - 0x80);
    static const std::array<char32_t, 48> boxDrawing = {
        0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556,
        0x2555, 0x2563, 0x2551, 0x2557, 0x255D, 0x255C, 0x255B, 0x2510,
        0x2514, 0x2534, 0x252C, 0x251C, 0x2500, 0x253C, 0x255E, 0x255F,
        0x255A, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256C, 0x2567,
        0x2568, 0x2564, 0x2565, 0x2559, 0x2558, 0x2552, 0x2553, 0x256B,
        0x256A, 0x2518, 0x250C, 0x2588, 0x2584, 0x258C, 0x2590, 0x2580,
    };
    if (value >= 0xB0 && value <= 0xDF) return boxDrawing[value - 0xB0];
    switch (value) {
    case 0x8A: return 0x060C; case 0x8B: return 0x0640; case 0x8C: return 0x061F;
    case 0x8D: return 0x0627; case 0x8E: return 0x0626; case 0x8F: return 0x0621;
    case 0x90: case 0x91: return 0x0627; case 0x92: case 0x93: return 0x0628;
    case 0x94: case 0x95: return 0x067E; case 0x96: case 0x97: return 0x062A;
    case 0x98: case 0x99: return 0x062B; case 0x9A: case 0x9B: return 0x062C;
    case 0x9C: case 0x9D: return 0x0686; case 0x9E: case 0x9F: return 0x062D;
    case 0xA0: case 0xA1: return 0x062E; case 0xA2: return 0x062F;
    case 0xA3: return 0x0630; case 0xA4: return 0x0631; case 0xA5: return 0x0632;
    case 0xA6: return 0x0698; case 0xA7: case 0xA8: return 0x0633;
    case 0xA9: case 0xAA: return 0x0634; case 0xAB: case 0xAC: return 0x0635;
    case 0xAD: case 0xAE: return 0x0636; case 0xAF: return 0x0637;
    case 0xE0: return 0x0638; case 0xE1: return 0x200C;
    case 0xE2: case 0xE3: case 0xE4: return 0x0639;
    case 0xE5: case 0xE6: case 0xE7: case 0xE8: return 0x063A;
    case 0xE9: case 0xEA: return 0x0641; case 0xEB: case 0xEC: return 0x0642;
    case 0xED: case 0xEE: return 0x06A9; case 0xEF: case 0xF0: return 0x06AF;
    case 0xF1: case 0xF2: case 0xF3: return 0x0644; case 0xF4: case 0xF5: return 0x0645;
    case 0xF6: case 0xF7: return 0x0646; case 0xF8: return 0x0648;
    case 0xF9: case 0xFA: case 0xFB: return 0x0647;
    case 0xFC: case 0xFD: case 0xFE: return 0x06CC; case 0xFF: return U' ';
    default: return 0x061F;
    }
}

// Digit runs are pulled out before shaping and reinserted afterwards, because
// numbers keep left-to-right order inside right-to-left text.
NumberExtraction excludeNumbers(const std::vector<unsigned char>& bytes) {
    NumberExtraction result;
    std::size_t index = 0;
    while (index < bytes.size()) {
        if (!isAsciiDigit(bytes[index])) {
            result.masked.push_back(bytes[index]);
            ++index;
            continue;
        }

        std::string number;
        while (index < bytes.size() && isAsciiDigit(bytes[index])) {
            number.push_back(static_cast<char>(bytes[index]));
            ++index;
        }
        result.numbers.push_back(number);
        result.masked.push_back('#');
    }
    return result;
}

std::u32string includeNumbers(std::u32string text, std::vector<std::string> numbers) {
    for (;;) {
        const std::size_t marker = text.find(U'#');
        if (marker == std::u32string::npos || numbers.empty()) {
            break;
        }

        std::string number = numbers.back();
        numbers.pop_back();
        std::reverse(number.begin(), number.end());

        std::u32string replacement;
        replacement.reserve(number.size());
        for (const char c : number) {
            replacement.push_back(static_cast<char32_t>(static_cast<unsigned char>(c)));
        }
        text.replace(marker, 1, replacement);
    }
    return text;
}

unsigned char mappedValue(const std::unordered_map<unsigned char, unsigned char>& map, unsigned char currentChar) {
    const auto it = map.find(currentChar);
    return it == map.end() ? currentChar : it->second;
}

unsigned char mapperCharIsNotFinal(unsigned char currentChar) {
    return mappedValue(kMapperCharIsNotFinal, currentChar);
}

unsigned char mapperNextCharFinal(unsigned char currentChar) {
    const auto it = kMapperNextCharFinal.find(currentChar);
    return it == kMapperNextCharFinal.end() ? mapperCharIsNotFinal(currentChar) : it->second;
}

unsigned char mapperPreviousCharFinal(unsigned char currentChar) {
    const auto it = kMapperPreviousCharFinal.find(currentChar);
    return it == kMapperPreviousCharFinal.end() ? mapperCharIsNotFinal(currentChar) : it->second;
}

unsigned char mapperPreviousCharNextCharFinal(unsigned char currentChar) {
    const auto it = kMapperPreviousCharNextCharFinal.find(currentChar);
    return it == kMapperPreviousCharNextCharFinal.end() ? mapperCharIsNotFinal(currentChar) : it->second;
}

bool isFinalLetter(unsigned char value, const std::vector<unsigned char>& singles) {
    return std::find(singles.begin(), singles.end(), value) != singles.end();
}

std::vector<unsigned char> trimAsciiSpaces(std::vector<unsigned char> bytes) {
    while (!bytes.empty() && bytes.front() == ' ') {
        bytes.erase(bytes.begin());
    }
    while (!bytes.empty() && bytes.back() == ' ') {
        bytes.pop_back();
    }
    return bytes;
}

std::vector<unsigned char> nonJoiningLettersCp1256() {
    std::u32string letters(kNonJoiningLetters.begin(), kNonJoiningLetters.end());
    return textcodec::utf32ToCp1256(letters);
}

} // namespace

ConversionResult toUnicode(const std::vector<unsigned char>& inputBytes) {
    ConversionResult result;
    std::vector<unsigned char> bytes = trimAsciiSpaces(inputBytes);

    if (bytes.empty()) {
        result.ok = true;
        return result;
    }

    std::vector<std::string> numbers;
    if (!isNumberOnly(bytes)) {
        std::reverse(bytes.begin(), bytes.end());
        NumberExtraction extracted = excludeNumbers(bytes);
        bytes = std::move(extracted.masked);
        numbers = std::move(extracted.numbers);
    }

    std::vector<unsigned char> mapped;
    mapped.reserve(bytes.size() * 2);
    for (std::size_t i = 0; i < bytes.size(); ++i) {
        const unsigned char current = bytes[i];
        if (current < 128) {
            mapped.push_back(current);
        } else {
            const auto it = kIranTo1256.find(current);
            if (it != kIranTo1256.end()) {
                mapped.push_back(it->second);
            }
        }

        // The lam-alef ligature expands back into two letters.
        if (current == kLaaArabic) {
            mapped.push_back(199);
        }
    }

    std::u32string unicodeText = textcodec::trimWhitespace(textcodec::cp1256ToUtf32(mapped));
    unicodeText = includeNumbers(std::move(unicodeText), std::move(numbers));

    result.text = utf32ToUtf8(normalizePersianOutput(reverseNumbersAndLetters(unicodeText)));
    result.ok = true;
    result.bytes = inputBytes;
    return result;
}

ConversionResult toUnicodeFromText(const std::string& iranSystemText) {
    return toUnicode(textcodec::utf8ToCp1256(iranSystemText));
}

ConversionResult fromUnicode(const std::string& text, bool convertNumbers) {
    ConversionResult result;

    const std::u32string source = utf8ToUtf32(text);
    if (textcodec::trimWhitespace(source).empty()) {
        result.ok = true;
        return result;
    }

    // The shaping loop inspects the neighbours of every character, so the text
    // is padded with spaces to give the first and last characters a context.
    std::u32string prepared;
    prepared.push_back(U' ');
    prepared += reverseNumbersAndLetters(source);
    prepared.push_back(U' ');

    const std::vector<unsigned char> bytes1256 = textcodec::utf32ToCp1256(prepared);
    const std::vector<unsigned char> singles = nonJoiningLettersCp1256();

    std::vector<unsigned char> iranBytes;
    iranBytes.reserve(bytes1256.size());
    unsigned char previousIran = 0;
    for (std::size_t i = 0; i < bytes1256.size(); ++i) {
        const unsigned char current = bytes1256[i];
        unsigned char converted = current;

        if (convertNumbers && isAsciiDigit(current)) {
            converted = latinLetterToIranSystem(current);
            iranBytes.push_back(converted);
            previousIran = converted;
            continue;
        }

        if (isLatinLetter(current)) {
            converted = mirroredCharacter(current);
            iranBytes.push_back(converted);
            previousIran = converted;
            continue;
        }

        if (i == 0 || i + 1 == bytes1256.size()) {
            continue;
        }

        const unsigned char previous = bytes1256[i - 1];
        const unsigned char next = bytes1256[i + 1];
        const bool previousFinal = isWhitespaceOrLatinOrQuestionMark(previous) || isFinalLetter(previous, singles);
        const bool nextFinal = isWhitespaceOrLatinOrQuestionMark(next);

        if (previousFinal && nextFinal) {
            converted = mapperPreviousCharNextCharFinal(current);
        } else if (previousFinal) {
            converted = mapperPreviousCharFinal(current);
        } else if (nextFinal) {
            converted = mapperNextCharFinal(current);
        } else {
            converted = mapperCharIsNotFinal(current);
        }

        // Lam followed by alef collapses into the single lam-alef glyph.
        if (converted == kAlefChasban && previousIran == kLaamAvval && !iranBytes.empty()) {
            iranBytes.back() = kLaaArabic;
            previousIran = kLaaArabic;
            continue;
        }

        iranBytes.push_back(converted);
        previousIran = converted;
    }

    std::reverse(iranBytes.begin(), iranBytes.end());
    result.bytes = trimAsciiSpaces(std::move(iranBytes));
    result.text = text;
    result.ok = true;
    return result;
}

ConversionResult fromUnicodeToText(const std::string& text, bool convertNumbers) {
    ConversionResult result = fromUnicode(text, convertNumbers);
    if (!result.ok) {
        return result;
    }
    result.text = textcodec::cp1256ToUtf8(result.bytes);
    return result;
}

ConversionResult toAtmEngineUnicode(const std::vector<unsigned char>& inputBytes) {
    ConversionResult result;
    std::u32string output;
    output.reserve(inputBytes.size());
    for (const unsigned char value : inputBytes) {
        output.push_back(atmEngineIranSystemChar(value));
    }
    result.ok = true;
    result.bytes = inputBytes;
    result.text = utf32ToUtf8(output);
    return result;
}

ConversionResult fromUnicodeAtmEngine(const std::string& text, bool convertNumbers) {
    ConversionResult result;
    const std::u32string source = utf8ToUtf32(text);

    std::vector<unsigned char> shaped;
    shaped.reserve(source.size());
    bool connectPrevious = false;

    for (std::size_t i = 0; i < source.size(); ++i) {
        const char32_t currentCode = source[i];
        const auto currentIt = kAtmEngineCharMap.find(currentCode);
        if (currentIt == kAtmEngineCharMap.end()) {
            shaped.push_back(static_cast<unsigned char>(currentCode & 0xFFu));
            connectPrevious = false;
            continue;
        }

        const EngineCharMapEntry& current = currentIt->second;
        const EngineCharMapEntry* next = nullptr;
        if (i + 1 < source.size()) {
            const auto nextIt = kAtmEngineCharMap.find(source[i + 1]);
            if (nextIt != kAtmEngineCharMap.end()) {
                next = &nextIt->second;
            }
        }
        const bool connectNext = next != nullptr && current.connectNext && next->connectPrev;
        const unsigned char shapedChar = connectPrevious
            ? (connectNext ? current.both : current.previous)
            : (connectNext ? current.next : current.single);
        shaped.push_back(shapedChar);
        connectPrevious = connectNext;
    }

    // Lam-alef collapses to a single glyph in the engine encoding too.
    std::vector<unsigned char> merged;
    merged.reserve(shaped.size());
    for (std::size_t i = 0; i < shaped.size(); ++i) {
        if (i + 1 < shaped.size() && shaped[i] == 0xF3 && shaped[i + 1] == 0x91) {
            merged.push_back(0xF2);
            ++i;
        } else {
            merged.push_back(shaped[i]);
        }
    }

    // Persian runs are emitted right-to-left; Latin and digits keep their order.
    std::vector<unsigned char> output;
    output.reserve(merged.size());
    for (std::size_t i = 0; i < merged.size(); ++i) {
        unsigned char current = merged[i];
        if (!convertNumbers && current >= 0x80 && current <= 0x89) {
            current = static_cast<unsigned char>('0' + current - 0x80);
        }
        if (current < 0x8D) {
            output.push_back(current);
            continue;
        }

        const std::size_t start = i;
        std::size_t end = i;
        while (end < merged.size() &&
               (merged[end] >= 0x8D ||
                (merged[end] == ' ' && end + 1 < merged.size() && merged[end + 1] >= 0x8D))) {
            ++end;
        }
        for (std::size_t cursor = end; cursor-- > start;) {
            output.push_back(merged[cursor]);
        }
        i = end - 1;
    }

    result.ok = true;
    result.bytes = std::move(output);
    result.text = text;
    return result;
}

} // namespace iransystem
