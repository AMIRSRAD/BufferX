#include "bufferx/PinTranslation.h"

#include "bufferx/Crypto.h"
#include "bufferx/Hex.h"

#include <openssl/rand.h>

#include <algorithm>
#include <cctype>

namespace {

PinTranslationResult fail(const std::string& error) {
    PinTranslationResult result;
    result.error = error;
    return result;
}

std::string normalize(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    value.erase(std::remove_if(value.begin(), value.end(), [](unsigned char ch) {
        return ch == ' ' || ch == '-' || ch == '_' || ch == '/';
    }), value.end());
    return value;
}

bool digits(const std::string& value) {
    return !value.empty() && std::all_of(value.begin(), value.end(), [](unsigned char ch) {
        return std::isdigit(ch) != 0;
    });
}

int formatNibble(const std::string& format) {
    const std::string value = normalize(format);
    if (value == "ansi" || value == "iso0" || value == "ansiiso0" || value == "ansiiso0atm") return 0;
    if (value == "iso1" || value == "iso1atm") return 1;
    return -1;
}

std::vector<unsigned char> packNibbles(const std::string& text) {
    std::vector<unsigned char> bytes;
    bytes.reserve(text.size() / 2);
    auto nibble = [](char ch) -> unsigned char {
        if (ch >= '0' && ch <= '9') return static_cast<unsigned char>(ch - '0');
        return static_cast<unsigned char>(std::toupper(static_cast<unsigned char>(ch)) - 'A' + 10);
    };
    for (size_t i = 0; i < text.size(); i += 2) {
        bytes.push_back(static_cast<unsigned char>((nibble(text[i]) << 4) | nibble(text[i + 1])));
    }
    return bytes;
}

std::string blockHex(const std::vector<unsigned char>& bytes) {
    return toHex(bytes, true);
}

bool validatePan(const std::string& pan, std::string& error) {
    if (!digits(pan) || pan.size() < 12 || pan.size() > 19) {
        error = "ATM-engine PAN must contain 12 to 19 digits.";
        return false;
    }
    return true;
}

std::vector<unsigned char> panMask(const std::string& pan) {
    return packNibbles("0000" + pan.substr(pan.size() - 12));
}

PinTranslationResult transform(const std::vector<unsigned char>& block,
                               const std::string& algorithmName,
                               const std::string& keyHex,
                               bool encrypt) {
    if (block.size() != 8) return fail("ATM-engine PIN block must be exactly 8 bytes.");
    const std::string algorithm = normalize(algorithmName);
    const HexParseResult key = fromHex(keyHex);
    if (!key.ok) return fail(key.error);

    std::string cipher;
    if (algorithm == "des") {
        if (key.bytes.size() != 8) return fail("DES PIN key must be exactly 8 bytes.");
        cipher = "des-ecb";
    } else if (algorithm == "2key3des" || algorithm == "3des" || algorithm == "trides") {
        if (key.bytes.size() != 16) return fail("Two-key 3DES PIN key must be exactly 16 bytes.");
        cipher = "3des-ecb";
    } else if (algorithm == "tsndes") {
        if (!encrypt) return fail("ATM-engine TSN-DES has no source/decryption operation.");
        if (key.bytes.size() != 16) return fail("TSN-DES key must contain two 8-byte keys.");
        const std::vector<unsigned char> key1(key.bytes.begin(), key.bytes.begin() + 8);
        const std::vector<unsigned char> key2(key.bytes.begin() + 8, key.bytes.end());
        const CryptoResult derived = CryptoEngine::transform("des-ecb", true, block,
                                                              blockHex(key1), std::string(), false);
        if (!derived.ok) return fail(derived.error);
        const CryptoResult encrypted = CryptoEngine::transform("des-ecb", true, key2,
                                                                blockHex(derived.bytes), std::string(), false);
        if (!encrypted.ok) return fail(encrypted.error);
        PinTranslationResult result;
        result.ok = true;
        result.translatedBlock = encrypted.bytes;
        return result;
    } else {
        return fail("PIN algorithm must be DES, 2-key 3DES, or destination-only TSN-DES.");
    }

    const CryptoResult transformed = CryptoEngine::transform(cipher, encrypt, block,
                                                               keyHex, std::string(), false);
    if (!transformed.ok) return fail(transformed.error);
    PinTranslationResult result;
    result.ok = true;
    result.translatedBlock = transformed.bytes;
    return result;
}

} // namespace

namespace pintranslation {

PinTranslationResult createAtmClearBlock(const std::string& format,
                                         const std::string& pin,
                                         const std::string& pan,
                                         unsigned char iso1Filler) {
    const int formatCode = formatNibble(format);
    if (formatCode < 0) return fail("ATM-engine format must be ANSI / ISO-0 or ISO-1.");
    if (!digits(pin) || pin.size() < 4 || pin.size() > 12) return fail("PIN must contain 4 to 12 digits.");
    std::string error;
    if (!validatePan(pan, error)) return fail(error);

    unsigned char filler = 0x0F;
    if (formatCode == 1) {
        filler = iso1Filler;
        if (filler == 0) {
            unsigned char random = 0;
            if (RAND_bytes(&random, 1) != 1) return fail("Secure ISO-1 filler generation failed.");
            filler = static_cast<unsigned char>((random % 15) + 1);
        }
        if (filler > 0x0F) return fail("ISO-1 filler nibble must be between 1 and F.");
    }

    static const char* kHex = "0123456789ABCDEF";
    std::string clearText;
    clearText.push_back(kHex[formatCode]);
    clearText.push_back(kHex[pin.size()]);
    clearText += pin;
    clearText.append(16 - clearText.size(), kHex[filler]);
    std::vector<unsigned char> clear = packNibbles(clearText);
    const std::vector<unsigned char> mask = panMask(pan);
    for (size_t i = 0; i < clear.size(); ++i) clear[i] ^= mask[i];

    PinTranslationResult result;
    result.ok = true;
    result.pin = pin;
    result.clearBlock = std::move(clear);
    return result;
}

PinTranslationResult decodeAtmClearBlock(const std::string& format,
                                         const std::vector<unsigned char>& clearBlock,
                                         const std::string& pan) {
    const int expectedFormat = formatNibble(format);
    if (expectedFormat < 0) return fail("ATM-engine format must be ANSI / ISO-0 or ISO-1.");
    if (clearBlock.size() != 8) return fail("ATM-engine PIN block must be exactly 8 bytes.");
    std::string error;
    if (!validatePan(pan, error)) return fail(error);

    std::vector<unsigned char> unmasked = clearBlock;
    const std::vector<unsigned char> mask = panMask(pan);
    for (size_t i = 0; i < unmasked.size(); ++i) unmasked[i] ^= mask[i];
    const int actualFormat = (unmasked[0] >> 4) & 0x0F;
    const int pinLength = unmasked[0] & 0x0F;
    if (actualFormat != expectedFormat) return fail("Decrypted PIN block format does not match the selected source format.");
    if (pinLength < 4 || pinLength > 12) return fail("Decrypted PIN length is invalid.");

    const std::string hex = blockHex(unmasked);
    const std::string pin = hex.substr(2, static_cast<size_t>(pinLength));
    if (!digits(pin)) return fail("Decrypted PIN contains non-digit characters.");
    PinTranslationResult result;
    result.ok = true;
    result.pin = pin;
    result.clearBlock = clearBlock;
    return result;
}

PinTranslationResult translate(const std::vector<unsigned char>& encryptedBlock,
                               const std::string& pan,
                               const std::string& sourceFormat,
                               const std::string& sourceAlgorithm,
                               const std::string& sourceKeyHex,
                               const std::string& destinationFormat,
                               const std::string& destinationAlgorithm,
                               const std::string& destinationKeyHex) {
    PinTranslationResult decrypted = transform(encryptedBlock, sourceAlgorithm, sourceKeyHex, false);
    if (!decrypted.ok) return decrypted;
    PinTranslationResult decoded = decodeAtmClearBlock(sourceFormat, decrypted.translatedBlock, pan);
    if (!decoded.ok) return decoded;

    std::vector<unsigned char> destinationClear = decrypted.translatedBlock;
    if (formatNibble(sourceFormat) != formatNibble(destinationFormat)) {
        PinTranslationResult rebuilt = createAtmClearBlock(destinationFormat, decoded.pin, pan);
        if (!rebuilt.ok) return rebuilt;
        destinationClear = rebuilt.clearBlock;
    }
    PinTranslationResult encrypted = transform(destinationClear, destinationAlgorithm, destinationKeyHex, true);
    if (!encrypted.ok) return encrypted;
    encrypted.pin = decoded.pin;
    encrypted.clearBlock = std::move(destinationClear);
    return encrypted;
}

} // namespace pintranslation
