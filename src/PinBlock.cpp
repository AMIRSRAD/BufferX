#include "PinBlock.h"

#include <algorithm>
#include <cctype>

namespace {

bool isDigitsOnly(const std::string& value) {
    return !value.empty() &&
           std::all_of(value.begin(), value.end(), [](unsigned char ch) { return std::isdigit(ch) != 0; });
}

int hexNibble(char ch) {
    if (ch >= '0' && ch <= '9') {
        return ch - '0';
    }
    if (ch >= 'A' && ch <= 'F') {
        return ch - 'A' + 10;
    }
    if (ch >= 'a' && ch <= 'f') {
        return ch - 'a' + 10;
    }
    return -1;
}

std::vector<unsigned char> packNibbles(const std::string& hexText, std::string& error) {
    if ((hexText.size() % 2) != 0) {
        error = "Internal PIN block packing error.";
        return {};
    }

    std::vector<unsigned char> bytes;
    bytes.reserve(hexText.size() / 2);
    for (size_t i = 0; i < hexText.size(); i += 2) {
        const int high = hexNibble(hexText[i]);
        const int low = hexNibble(hexText[i + 1]);
        if (high < 0 || low < 0) {
            error = "Internal PIN block packing error.";
            return {};
        }
        bytes.push_back(static_cast<unsigned char>((high << 4) | low));
    }
    return bytes;
}

std::string pinFieldHex(const std::string& pin, std::string& error) {
    if (!isDigitsOnly(pin)) {
        error = "PIN must contain digits only.";
        return {};
    }
    if (pin.size() < 4 || pin.size() > 12) {
        error = "PIN length must be between 4 and 12 digits.";
        return {};
    }

    std::string field = "0";
    field.push_back(static_cast<char>('0' + pin.size()));
    field += pin;
    while (field.size() < 16) {
        field.push_back('F');
    }
    return field;
}

std::string panFieldHex(const std::string& pan, std::string& error) {
    if (!isDigitsOnly(pan)) {
        error = "PAN must contain digits only.";
        return {};
    }
    if (pan.size() < 13) {
        error = "PAN must be at least 13 digits for ISO-0 PIN blocks.";
        return {};
    }

    const std::string withoutCheck = pan.substr(0, pan.size() - 1);
    const std::string right12 = withoutCheck.substr(withoutCheck.size() - 12);
    return std::string("0000") + right12;
}

} // namespace

namespace pinblock {

PinBlockResult createIso0(const std::string& pin, const std::string& pan) {
    PinBlockResult result;
    std::string error;
    const std::string pinField = pinFieldHex(pin, error);
    if (!error.empty()) {
        result.error = error;
        return result;
    }

    const std::string panField = panFieldHex(pan, error);
    if (!error.empty()) {
        result.error = error;
        return result;
    }

    const std::vector<unsigned char> pinBytes = packNibbles(pinField, error);
    if (!error.empty()) {
        result.error = error;
        return result;
    }
    const std::vector<unsigned char> panBytes = packNibbles(panField, error);
    if (!error.empty()) {
        result.error = error;
        return result;
    }

    result.bytes.resize(8, 0);
    for (size_t i = 0; i < 8; ++i) {
        result.bytes[i] = static_cast<unsigned char>(pinBytes[i] ^ panBytes[i]);
    }
    result.pin = pin;
    result.ok = true;
    return result;
}

PinBlockResult decodeIso0(const std::vector<unsigned char>& block, const std::string& pan) {
    PinBlockResult result;
    if (block.size() != 8) {
        result.error = "ISO-0 PIN block must be exactly 8 bytes.";
        return result;
    }

    std::string error;
    const std::string panField = panFieldHex(pan, error);
    if (!error.empty()) {
        result.error = error;
        return result;
    }
    const std::vector<unsigned char> panBytes = packNibbles(panField, error);
    if (!error.empty()) {
        result.error = error;
        return result;
    }

    std::vector<unsigned char> clearBytes(8, 0);
    for (size_t i = 0; i < 8; ++i) {
        clearBytes[i] = static_cast<unsigned char>(block[i] ^ panBytes[i]);
    }

    std::string clearHex;
    clearHex.reserve(16);
    static const char* kHex = "0123456789ABCDEF";
    for (unsigned char byte : clearBytes) {
        clearHex.push_back(kHex[(byte >> 4) & 0x0F]);
        clearHex.push_back(kHex[byte & 0x0F]);
    }

    if (clearHex[0] != '0') {
        result.error = "PIN block format nibble is not ISO-0.";
        return result;
    }

    const int pinLength = clearHex[1] - '0';
    if (pinLength < 4 || pinLength > 12) {
        result.error = "Decoded PIN length is invalid.";
        return result;
    }

    std::string pin = clearHex.substr(2, static_cast<size_t>(pinLength));
    if (!isDigitsOnly(pin)) {
        result.error = "Decoded PIN contains non-digit characters.";
        return result;
    }

    const std::string filler = clearHex.substr(2 + static_cast<size_t>(pinLength));
    if (!std::all_of(filler.begin(), filler.end(), [](char ch) { return ch == 'F'; })) {
        result.error = "PIN block filler is invalid for ISO-0.";
        return result;
    }

    result.pin = pin;
    result.bytes = block;
    result.ok = true;
    return result;
}

} // namespace pinblock
