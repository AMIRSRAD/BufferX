#include "IranSystem.h"

#include <QRegularExpression>

#include <algorithm>
#include <array>
#include <unordered_map>
#include <vector>

#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#endif

namespace iransystem {

namespace {

#ifdef _WIN32
constexpr UINT kWindows1256CodePage = 1256;
#endif
constexpr unsigned char kAlefChasban = 145;
constexpr unsigned char kLaaArabic = 242;
constexpr unsigned char kLaamAvval = 243;
constexpr unsigned char kQuestionMark = 191;

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

QString reverseQString(const QString& text) {
    QString reversed;
    reversed.reserve(text.size());
    for (int i = text.size() - 1; i >= 0; --i) {
        reversed.append(text.at(i));
    }
    return reversed;
}

QString reverseNumbersAndLetters(const QString& text) {
    static const QRegularExpression pattern(QStringLiteral("[A-Za-z0-9]+"));
    QString result;
    int cursor = 0;
    QRegularExpressionMatchIterator it = pattern.globalMatch(text);
    while (it.hasNext()) {
        const QRegularExpressionMatch match = it.next();
        result += text.mid(cursor, match.capturedStart() - cursor);
        result += reverseQString(match.captured(0));
        cursor = match.capturedEnd();
    }
    result += text.mid(cursor);
    return result.trimmed();
}

QString normalizePersianOutput(QString text) {
    text.replace(QChar(0x064A), QChar(0x06CC));
    text.replace(QChar(0x0649), QChar(0x06CC));
    text.replace(QChar(0x0643), QChar(0x06A9));
    return text;
}

struct NumberExtraction {
    std::vector<unsigned char> masked;
    std::vector<QByteArray> numbers;
};

NumberExtraction excludeNumbers(const std::vector<unsigned char>& bytes) {
    NumberExtraction result;
    size_t index = 0;
    while (index < bytes.size()) {
        if (!isAsciiDigit(bytes[index])) {
            result.masked.push_back(bytes[index]);
            ++index;
            continue;
        }

        QByteArray number;
        while (index < bytes.size() && isAsciiDigit(bytes[index])) {
            number.append(static_cast<char>(bytes[index]));
            ++index;
        }
        result.numbers.push_back(number);
        result.masked.push_back('#');
    }
    return result;
}

QString includeNumbers(QString text, std::vector<QByteArray> numbers) {
    while (true) {
        const int marker = text.indexOf(QLatin1Char('#'));
        if (marker < 0 || numbers.empty()) {
            break;
        }

        QByteArray number = numbers.back();
        numbers.pop_back();
        std::reverse(number.begin(), number.end());
        text.replace(marker, 1, QString::fromLatin1(number));
    }
    return text;
}

#ifdef _WIN32
QString decodeWindows1256(const std::vector<unsigned char>& bytes, QString& error) {
    if (bytes.empty()) {
        return QString();
    }

    const int wideLength = MultiByteToWideChar(kWindows1256CodePage,
                                               0,
                                               reinterpret_cast<const char*>(bytes.data()),
                                               static_cast<int>(bytes.size()),
                                               nullptr,
                                               0);
    if (wideLength <= 0) {
        error = QStringLiteral("Failed to decode Windows-1256 bytes.");
        return QString();
    }

    std::wstring wide(static_cast<size_t>(wideLength), L'\0');
    const int converted = MultiByteToWideChar(kWindows1256CodePage,
                                              0,
                                              reinterpret_cast<const char*>(bytes.data()),
                                              static_cast<int>(bytes.size()),
                                              wide.data(),
                                              wideLength);
    if (converted != wideLength) {
        error = QStringLiteral("Failed to decode Windows-1256 bytes.");
        return QString();
    }

    return QString::fromWCharArray(wide.data(), wideLength);
}

std::vector<unsigned char> encodeWindows1256(const QString& text, QString& error) {
    if (text.isEmpty()) {
        return {};
    }

    std::wstring wide = text.toStdWString();
    const int narrowLength = WideCharToMultiByte(kWindows1256CodePage,
                                                 0,
                                                 wide.c_str(),
                                                 static_cast<int>(wide.size()),
                                                 nullptr,
                                                 0,
                                                 nullptr,
                                                 nullptr);
    if (narrowLength <= 0) {
        error = QStringLiteral("Failed to encode text as Windows-1256.");
        return {};
    }

    std::string narrow(static_cast<size_t>(narrowLength), '\0');
    const int converted = WideCharToMultiByte(kWindows1256CodePage,
                                              0,
                                              wide.c_str(),
                                              static_cast<int>(wide.size()),
                                              narrow.data(),
                                              narrowLength,
                                              nullptr,
                                              nullptr);
    if (converted != narrowLength) {
        error = QStringLiteral("Failed to encode text as Windows-1256.");
        return {};
    }

    return std::vector<unsigned char>(narrow.begin(), narrow.end());
}
#endif

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

} // namespace

ConversionResult toUnicode(const std::vector<unsigned char>& inputBytes) {
    ConversionResult result;
    std::vector<unsigned char> bytes = trimAsciiSpaces(inputBytes);

    if (bytes.empty()) {
        result.ok = true;
        return result;
    }

    std::vector<QByteArray> numbers;
    if (!isNumberOnly(bytes)) {
        std::reverse(bytes.begin(), bytes.end());
        NumberExtraction extracted = excludeNumbers(bytes);
        bytes = std::move(extracted.masked);
        numbers = std::move(extracted.numbers);
    }

    std::vector<unsigned char> mapped;
    mapped.reserve(bytes.size() * 2);
    for (size_t i = 0; i < bytes.size(); ++i) {
        const unsigned char current = bytes[i];
        if (current < 128) {
            mapped.push_back(current);
        } else {
            const auto it = kIranTo1256.find(current);
            if (it != kIranTo1256.end()) {
                mapped.push_back(it->second);
            }
        }

        if (current == kLaaArabic) {
            mapped.push_back(199);
        }
    }

#ifdef _WIN32
    QString error;
    QString unicodeText = decodeWindows1256(mapped, error).trimmed();
    if (!error.isEmpty()) {
        result.error = error;
        return result;
    }
    unicodeText = includeNumbers(unicodeText, std::move(numbers));
    result.text = normalizePersianOutput(reverseNumbersAndLetters(unicodeText));
    result.ok = true;
    result.bytes = inputBytes;
    return result;
#else
    result.error = QStringLiteral("IranSystem conversion is only available on Windows builds.");
    return result;
#endif
}

ConversionResult toUnicodeFromText(const QString& iranSystemText) {
#ifdef _WIN32
    QString error;
    const std::vector<unsigned char> bytes = encodeWindows1256(iranSystemText, error);
    if (!error.isEmpty()) {
        ConversionResult result;
        result.error = error;
        return result;
    }
    return toUnicode(bytes);
#else
    ConversionResult result;
    result.error = QStringLiteral("IranSystem conversion is only available on Windows builds.");
    return result;
#endif
}

ConversionResult fromUnicode(const QString& text, bool convertNumbers) {
    ConversionResult result;
    if (text.trimmed().isEmpty()) {
        result.ok = true;
        return result;
    }

#ifdef _WIN32
    QString error;
    const QString prepared = QStringLiteral(" %1 ").arg(reverseNumbersAndLetters(text));
    const std::vector<unsigned char> bytes1256 = encodeWindows1256(prepared, error);
    if (!error.isEmpty()) {
        result.error = error;
        return result;
    }

    const std::vector<unsigned char> singles = encodeWindows1256(QStringLiteral("ءآأؤإادذرزژو"), error);
    if (!error.isEmpty()) {
        result.error = error;
        return result;
    }

    std::vector<unsigned char> iranBytes;
    iranBytes.reserve(bytes1256.size());
    unsigned char previousIran = 0;
    for (size_t i = 0; i < bytes1256.size(); ++i) {
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
#else
    result.error = QStringLiteral("IranSystem conversion is only available on Windows builds.");
    return result;
#endif
}

ConversionResult fromUnicodeToText(const QString& text, bool convertNumbers) {
    ConversionResult result = fromUnicode(text, convertNumbers);
    if (!result.ok) {
        return result;
    }

#ifdef _WIN32
    QString error;
    result.text = decodeWindows1256(result.bytes, error);
    if (!error.isEmpty()) {
        result.ok = false;
        result.error = error;
        result.text.clear();
        result.bytes.clear();
        return result;
    }
    return result;
#else
    result.error = QStringLiteral("IranSystem conversion is only available on Windows builds.");
    result.ok = false;
    result.bytes.clear();
    return result;
#endif
}

} // namespace iransystem
