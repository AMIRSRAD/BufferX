#include "bufferx/Mac.h"

#include "bufferx/Hex.h"

#include <openssl/des.h>

#include <algorithm>
#include <array>
#include <cstring>

namespace {

std::vector<unsigned char> expandKey24(const std::vector<unsigned char>& keyBytes, std::string& error) {
    if (keyBytes.size() != 8 && keyBytes.size() != 16 && keyBytes.size() != 24) {
        error = "MAC key must be 8, 16, or 24 bytes of hex.";
        return {};
    }

    std::vector<unsigned char> key24(24, 0);
    if (keyBytes.size() == 8) {
        std::copy(keyBytes.begin(), keyBytes.end(), key24.begin());
        std::copy(keyBytes.begin(), keyBytes.end(), key24.begin() + 8);
        std::copy(keyBytes.begin(), keyBytes.end(), key24.begin() + 16);
    } else if (keyBytes.size() == 16) {
        std::copy(keyBytes.begin(), keyBytes.end(), key24.begin());
        std::copy(keyBytes.begin(), keyBytes.begin() + 8, key24.begin() + 16);
    } else {
        std::copy(keyBytes.begin(), keyBytes.end(), key24.begin());
    }
    return key24;
}

std::vector<unsigned char> padPayload(std::vector<unsigned char> payload, MacPaddingMode paddingMode) {
    const size_t remainder = payload.size() % 8;
    if (paddingMode == MacPaddingMode::Iso9797Method2) {
        payload.push_back(0x80);
    } else if (remainder == 0) {
        return payload;
    }

    while ((payload.size() % 8) != 0) {
        payload.push_back(0x00);
    }
    return payload;
}

} // namespace

MacResult MacEngine::calculateAnsiX919(const std::vector<unsigned char>& payload,
                                       const std::string& keyHex,
                                       MacPaddingMode paddingMode,
                                       int outputBytes) {
    MacResult result;
    if (outputBytes <= 0 || outputBytes > 8) {
        result.error = "MAC output size must be between 1 and 8 bytes.";
        return result;
    }

    HexParseResult key = fromHex(keyHex);
    if (!key.ok) {
        result.error = "Invalid MAC key hex: " + key.error;
        return result;
    }

    std::string keyError;
    const std::vector<unsigned char> expandedKey = expandKey24(key.bytes, keyError);
    if (!keyError.empty()) {
        result.error = keyError;
        return result;
    }

    const std::vector<unsigned char> padded = padPayload(payload, paddingMode);
    if (padded.empty()) {
        result.error = "MAC payload is empty.";
        return result;
    }

    DES_cblock key1;
    DES_cblock key2;
    DES_cblock key3;
    std::memcpy(key1, expandedKey.data(), 8);
    std::memcpy(key2, expandedKey.data() + 8, 8);
    std::memcpy(key3, expandedKey.data() + 16, 8);

    DES_key_schedule ks1;
    DES_key_schedule ks2;
    DES_key_schedule ks3;
    DES_set_key_unchecked(&key1, &ks1);
    DES_set_key_unchecked(&key2, &ks2);
    DES_set_key_unchecked(&key3, &ks3);

    std::vector<unsigned char> cbcOut(padded.size(), 0);
    DES_cblock iv = {};
    DES_ncbc_encrypt(padded.data(),
                     cbcOut.data(),
                     static_cast<long>(padded.size()),
                     &ks1,
                     &iv,
                     DES_ENCRYPT);

    DES_cblock lastBlock;
    DES_cblock tempBlock;
    DES_cblock macBlock;
    std::memcpy(lastBlock, cbcOut.data() + (cbcOut.size() - 8), 8);
    DES_ecb_encrypt(&lastBlock, &tempBlock, &ks2, DES_DECRYPT);
    DES_ecb_encrypt(&tempBlock, &macBlock, &ks3, DES_ENCRYPT);

    result.macBytes.assign(macBlock, macBlock + outputBytes);
    result.ok = true;
    return result;
}
