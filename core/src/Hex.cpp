#include "bufferx/Hex.h"

#include <cctype>

namespace {
int hexValue(char ch) {
    if (ch >= '0' && ch <= '9') {
        return ch - '0';
    }
    if (ch >= 'a' && ch <= 'f') {
        return 10 + (ch - 'a');
    }
    if (ch >= 'A' && ch <= 'F') {
        return 10 + (ch - 'A');
    }
    return -1;
}
} // namespace

HexParseResult fromHex(const std::string& text) {
    HexParseResult result;
    int high = -1;
    for (char ch : text) {
        if (std::isspace(static_cast<unsigned char>(ch))) {
            continue;
        }
        int value = hexValue(ch);
        if (value < 0) {
            result.ok = false;
            result.error = "Invalid hex character.";
            return result;
        }
        if (high < 0) {
            high = value;
        } else {
            unsigned char byte = static_cast<unsigned char>((high << 4) | value);
            result.bytes.push_back(byte);
            high = -1;
        }
    }

    if (high >= 0) {
        result.ok = false;
        result.error = "Odd number of hex digits.";
        return result;
    }

    result.ok = true;
    return result;
}

std::string toHex(const std::vector<unsigned char>& bytes, bool uppercase) {
    static const char* digitsUpper = "0123456789ABCDEF";
    static const char* digitsLower = "0123456789abcdef";
    const char* digits = uppercase ? digitsUpper : digitsLower;

    std::string out;
    out.reserve(bytes.size() * 2);
    for (unsigned char byte : bytes) {
        out.push_back(digits[(byte >> 4) & 0x0F]);
        out.push_back(digits[byte & 0x0F]);
    }
    return out;
}
