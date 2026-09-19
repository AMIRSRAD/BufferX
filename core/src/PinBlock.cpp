#include "bufferx/PinBlock.h"

#include "bufferx/Hex.h"

#include <openssl/evp.h>
#include <openssl/rand.h>

#include <algorithm>
#include <cctype>
#include <memory>

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

std::string bytesToHex(const std::vector<unsigned char>& bytes) {
    return toHex(bytes, true);
}

bool validatePin(const std::string& pin, std::string& error) {
    if (!isDigitsOnly(pin)) {
        error = "PIN must contain digits only.";
        return false;
    }
    if (pin.size() < 4 || pin.size() > 12) {
        error = "PIN length must be between 4 and 12 digits.";
        return false;
    }
    return true;
}

bool randomNibbles(size_t count, int minimum, std::string& output, std::string& error) {
    std::vector<unsigned char> random(count);
    if (RAND_bytes(random.data(), static_cast<int>(random.size())) != 1) {
        error = "Secure random PIN-block filler generation failed.";
        return false;
    }
    static const char* kHex = "0123456789ABCDEF";
    output.clear();
    output.reserve(count);
    for (unsigned char byte : random) {
        output.push_back(kHex[minimum + (byte % static_cast<unsigned char>(16 - minimum))]);
    }
    return true;
}

PinBlockResult decodeClearField(const std::vector<unsigned char>& clearBytes,
                                char expectedFormat,
                                bool randomFiller,
                                size_t fieldNibbles = 16) {
    PinBlockResult result;
    if (clearBytes.size() * 2 < fieldNibbles) {
        result.error = "PIN block is shorter than its format requires.";
        return result;
    }
    const std::string clearHex = bytesToHex(clearBytes);
    if (clearHex[0] != expectedFormat) {
        result.error = std::string("PIN block format nibble is not ISO-") + expectedFormat + ".";
        return result;
    }
    const int pinLength = hexNibble(clearHex[1]);
    if (pinLength < 4 || pinLength > 12) {
        result.error = "Decoded PIN length is invalid.";
        return result;
    }
    result.pin = clearHex.substr(2, static_cast<size_t>(pinLength));
    if (!isDigitsOnly(result.pin)) {
        result.error = "Decoded PIN contains non-digit characters.";
        return result;
    }
    const size_t fillerEnd = expectedFormat == '4' ? 16 : fieldNibbles;
    const std::string filler = clearHex.substr(2 + static_cast<size_t>(pinLength),
                                               fillerEnd - 2 - static_cast<size_t>(pinLength));
    const bool fillerValid = std::all_of(filler.begin(), filler.end(), [&](char ch) {
        if (expectedFormat == '4') return ch == 'A';
        if (expectedFormat == '1') return hexNibble(ch) >= 0;
        if (randomFiller) return hexNibble(ch) >= 10;
        return ch == 'F';
    });
    if (!fillerValid) {
        result.error = "PIN block filler is invalid for the selected format.";
        result.pin.clear();
        return result;
    }
    result.bytes = clearBytes;
    result.ok = true;
    return result;
}

std::vector<unsigned char> xorBytes(const std::vector<unsigned char>& left,
                                    const std::vector<unsigned char>& right) {
    std::vector<unsigned char> output(left.size());
    for (size_t i = 0; i < output.size(); ++i) output[i] = left[i] ^ right[i];
    return output;
}

std::string iso4PanFieldHex(const std::string& pan, std::string& error) {
    if (!isDigitsOnly(pan) || pan.size() < 10 || pan.size() > 19) {
        error = "ISO-4 PAN must contain between 10 and 19 digits.";
        return {};
    }
    std::string normalizedPan = pan;
    int control = 0;
    if (normalizedPan.size() < 12) {
        normalizedPan.insert(normalizedPan.begin(), 12 - normalizedPan.size(), '0');
    } else {
        control = static_cast<int>(normalizedPan.size()) - 12;
    }
    static const char* kHex = "01234567";
    std::string field(1, kHex[control]);
    field += normalizedPan;
    field.append(32 - field.size(), '0');
    return field;
}

bool aesEcb(const std::vector<unsigned char>& input,
            const std::vector<unsigned char>& key,
            bool encrypt,
            std::vector<unsigned char>& output,
            std::string& error) {
    const EVP_CIPHER* cipher = nullptr;
    if (key.size() == 16) cipher = EVP_aes_128_ecb();
    else if (key.size() == 24) cipher = EVP_aes_192_ecb();
    else if (key.size() == 32) cipher = EVP_aes_256_ecb();
    else {
        error = "ISO-4 AES key must be 16, 24, or 32 bytes.";
        return false;
    }
    if (input.size() != 16) {
        error = "ISO-4 AES input must be exactly 16 bytes.";
        return false;
    }
    using CtxPtr = std::unique_ptr<EVP_CIPHER_CTX, decltype(&EVP_CIPHER_CTX_free)>;
    CtxPtr ctx(EVP_CIPHER_CTX_new(), EVP_CIPHER_CTX_free);
    if (!ctx) {
        error = "Failed to allocate AES context.";
        return false;
    }
    const int initialized = encrypt
        ? EVP_EncryptInit_ex(ctx.get(), cipher, nullptr, key.data(), nullptr)
        : EVP_DecryptInit_ex(ctx.get(), cipher, nullptr, key.data(), nullptr);
    if (initialized != 1) {
        error = "Failed to initialize ISO-4 AES cipher.";
        return false;
    }
    EVP_CIPHER_CTX_set_padding(ctx.get(), 0);
    output.resize(32);
    int length = 0;
    int finalLength = 0;
    const int updated = encrypt
        ? EVP_EncryptUpdate(ctx.get(), output.data(), &length, input.data(), 16)
        : EVP_DecryptUpdate(ctx.get(), output.data(), &length, input.data(), 16);
    const int finalized = encrypt
        ? EVP_EncryptFinal_ex(ctx.get(), output.data() + length, &finalLength)
        : EVP_DecryptFinal_ex(ctx.get(), output.data() + length, &finalLength);
    if (updated != 1 || finalized != 1) {
        error = "ISO-4 AES transform failed.";
        output.clear();
        return false;
    }
    output.resize(static_cast<size_t>(length + finalLength));
    return true;
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

PinBlockResult createIso1(const std::string& pin) {
    PinBlockResult result;
    std::string error;
    if (!validatePin(pin, error)) {
        result.error = error;
        return result;
    }
    std::string filler;
    if (!randomNibbles(14 - pin.size(), 0, filler, error)) {
        result.error = error;
        return result;
    }
    result.bytes = packNibbles("1" + std::string(1, "0123456789ABCDEF"[pin.size()]) + pin + filler, error);
    result.pin = pin;
    result.error = error;
    result.ok = error.empty();
    return result;
}

PinBlockResult decodeIso1(const std::vector<unsigned char>& block) {
    if (block.size() != 8) {
        PinBlockResult result;
        result.error = "ISO-1 PIN block must be exactly 8 bytes.";
        return result;
    }
    return decodeClearField(block, '1', false);
}

PinBlockResult createIso3(const std::string& pin, const std::string& pan) {
    PinBlockResult result;
    std::string error;
    if (!validatePin(pin, error)) {
        result.error = error;
        return result;
    }
    std::string filler;
    if (!randomNibbles(14 - pin.size(), 10, filler, error)) {
        result.error = error;
        return result;
    }
    const std::vector<unsigned char> pinBytes = packNibbles(
        "3" + std::string(1, "0123456789ABCDEF"[pin.size()]) + pin + filler, error);
    const std::string panField = panFieldHex(pan, error);
    if (!error.empty()) {
        result.error = error;
        return result;
    }
    const std::vector<unsigned char> panBytes = packNibbles(panField, error);
    result.bytes = xorBytes(pinBytes, panBytes);
    result.pin = pin;
    result.ok = true;
    return result;
}

PinBlockResult decodeIso3(const std::vector<unsigned char>& block, const std::string& pan) {
    PinBlockResult result;
    if (block.size() != 8) {
        result.error = "ISO-3 PIN block must be exactly 8 bytes.";
        return result;
    }
    std::string error;
    const std::vector<unsigned char> panBytes = packNibbles(panFieldHex(pan, error), error);
    if (!error.empty()) {
        result.error = error;
        return result;
    }
    return decodeClearField(xorBytes(block, panBytes), '3', true);
}

PinBlockResult encryptIso4(const std::string& pin, const std::string& pan, const std::string& keyHex) {
    PinBlockResult result;
    std::string error;
    if (!validatePin(pin, error)) {
        result.error = error;
        return result;
    }
    std::string random;
    if (!randomNibbles(16, 0, random, error)) {
        result.error = error;
        return result;
    }
    std::string pinField = "4" + std::string(1, "0123456789ABCDEF"[pin.size()]) + pin;
    pinField.append(16 - pinField.size(), 'A');
    pinField += random;
    const std::string panField = iso4PanFieldHex(pan, error);
    const HexParseResult key = fromHex(keyHex);
    if (!error.empty() || !key.ok) {
        result.error = !error.empty() ? error : key.error;
        return result;
    }
    const std::vector<unsigned char> pinBytes = packNibbles(pinField, error);
    const std::vector<unsigned char> panBytes = packNibbles(panField, error);
    std::vector<unsigned char> intermediateA;
    std::vector<unsigned char> encrypted;
    if (!aesEcb(pinBytes, key.bytes, true, intermediateA, error) ||
        !aesEcb(xorBytes(intermediateA, panBytes), key.bytes, true, encrypted, error)) {
        result.error = error;
        return result;
    }
    result.bytes = encrypted;
    result.pin = pin;
    result.ok = true;
    return result;
}

PinBlockResult decryptIso4(const std::vector<unsigned char>& block,
                           const std::string& pan,
                           const std::string& keyHex) {
    PinBlockResult result;
    if (block.size() != 16) {
        result.error = "ISO-4 encrypted PIN block must be exactly 16 bytes.";
        return result;
    }
    std::string error;
    const std::string panField = iso4PanFieldHex(pan, error);
    const HexParseResult key = fromHex(keyHex);
    if (!error.empty() || !key.ok) {
        result.error = !error.empty() ? error : key.error;
        return result;
    }
    const std::vector<unsigned char> panBytes = packNibbles(panField, error);
    std::vector<unsigned char> intermediateB;
    std::vector<unsigned char> clearPinField;
    if (!aesEcb(block, key.bytes, false, intermediateB, error) ||
        !aesEcb(xorBytes(intermediateB, panBytes), key.bytes, false, clearPinField, error)) {
        result.error = error;
        return result;
    }
    result = decodeClearField(clearPinField, '4', false, 32);
    if (result.ok) result.bytes = block;
    return result;
}

} // namespace pinblock
