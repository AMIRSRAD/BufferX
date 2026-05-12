#include "Crypto.h"

#include "Hex.h"

#include <openssl/evp.h>

#include <algorithm>
#include <cctype>

namespace {

std::string normalizeName(std::string value) {
    std::string normalized;
    normalized.reserve(value.size());
    for (unsigned char ch : value) {
        if (std::isalnum(ch)) {
            normalized.push_back(static_cast<char>(std::tolower(ch)));
        }
    }
    return normalized;
}

bool resolveCipher(const std::string& algorithm,
                   const EVP_CIPHER*& cipher,
                   int& keyLength,
                   int& ivLength) {
    const std::string normalized = normalizeName(algorithm);
    if (normalized == "desecb") {
        cipher = EVP_des_ecb();
        keyLength = 8;
        ivLength = 0;
        return true;
    }
    if (normalized == "descbc") {
        cipher = EVP_des_cbc();
        keyLength = 8;
        ivLength = 8;
        return true;
    }
    if (normalized == "3desecb" || normalized == "desedeecb" || normalized == "tripledesecb") {
        cipher = EVP_des_ede3_ecb();
        keyLength = 24;
        ivLength = 0;
        return true;
    }
    if (normalized == "3descbc" || normalized == "desedecbc" || normalized == "tripledescbc") {
        cipher = EVP_des_ede3_cbc();
        keyLength = 24;
        ivLength = 8;
        return true;
    }
    if (normalized == "aes128ecb") {
        cipher = EVP_aes_128_ecb();
        keyLength = 16;
        ivLength = 0;
        return true;
    }
    if (normalized == "aes128cbc") {
        cipher = EVP_aes_128_cbc();
        keyLength = 16;
        ivLength = 16;
        return true;
    }
    if (normalized == "aes256ecb") {
        cipher = EVP_aes_256_ecb();
        keyLength = 32;
        ivLength = 0;
        return true;
    }
    if (normalized == "aes256cbc") {
        cipher = EVP_aes_256_cbc();
        keyLength = 32;
        ivLength = 16;
        return true;
    }
    return false;
}

std::vector<unsigned char> adjustKey(const std::vector<unsigned char>& keyBytes,
                                     int requiredLength,
                                     std::string& error) {
    if (requiredLength == 24 && keyBytes.size() == 16) {
        std::vector<unsigned char> expanded(24, 0);
        std::copy(keyBytes.begin(), keyBytes.end(), expanded.begin());
        std::copy(keyBytes.begin(), keyBytes.begin() + 8, expanded.begin() + 16);
        return expanded;
    }
    if (static_cast<int>(keyBytes.size()) != requiredLength) {
        error = "Key length does not match algorithm requirements.";
        return {};
    }
    return keyBytes;
}

std::vector<unsigned char> adjustIv(const std::vector<unsigned char>& ivBytes,
                                    int requiredLength,
                                    std::string& error) {
    if (requiredLength == 0) {
        if (!ivBytes.empty()) {
            error = "IV is not used by the selected algorithm.";
            return {};
        }
        return {};
    }
    if (static_cast<int>(ivBytes.size()) != requiredLength) {
        error = "IV length does not match algorithm requirements.";
        return {};
    }
    return ivBytes;
}

} // namespace

CryptoResult CryptoEngine::transform(const std::string& algorithm,
                                     bool encrypt,
                                     const std::vector<unsigned char>& input,
                                     const std::string& keyHex,
                                     const std::string& ivHex,
                                     bool usePadding) {
    CryptoResult result;
    const EVP_CIPHER* cipher = nullptr;
    int keyLength = 0;
    int ivLength = 0;
    if (!resolveCipher(algorithm, cipher, keyLength, ivLength)) {
        result.error = "Unsupported algorithm.";
        return result;
    }

    HexParseResult keyParsed = fromHex(keyHex);
    if (!keyParsed.ok) {
        result.error = "Invalid key hex: " + keyParsed.error;
        return result;
    }
    std::string keyError;
    const std::vector<unsigned char> key = adjustKey(keyParsed.bytes, keyLength, keyError);
    if (!keyError.empty()) {
        result.error = keyError;
        return result;
    }

    HexParseResult ivParsed = fromHex(ivHex);
    if (!ivParsed.ok && !ivHex.empty()) {
        result.error = "Invalid IV hex: " + ivParsed.error;
        return result;
    }
    std::string ivError;
    const std::vector<unsigned char> iv = adjustIv(ivParsed.bytes, ivLength, ivError);
    if (!ivError.empty()) {
        result.error = ivError;
        return result;
    }

    EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
    if (!ctx) {
        result.error = "Failed to allocate cipher context.";
        return result;
    }

    bool ok = false;
    do {
        if (EVP_CipherInit_ex(ctx, cipher, nullptr, nullptr, nullptr, encrypt ? 1 : 0) != 1) {
            result.error = "Failed to initialize cipher.";
            break;
        }
        if (EVP_CIPHER_CTX_set_padding(ctx, usePadding ? 1 : 0) != 1) {
            result.error = "Failed to configure cipher padding.";
            break;
        }
        if (EVP_CipherInit_ex(ctx,
                              nullptr,
                              nullptr,
                              key.data(),
                              ivLength > 0 ? iv.data() : nullptr,
                              encrypt ? 1 : 0) != 1) {
            result.error = "Failed to set key and IV.";
            break;
        }

        std::vector<unsigned char> output(input.size() + EVP_CIPHER_block_size(cipher));
        int outLen1 = 0;
        if (EVP_CipherUpdate(ctx,
                             output.data(),
                             &outLen1,
                             input.empty() ? nullptr : input.data(),
                             static_cast<int>(input.size())) != 1) {
            result.error = encrypt ? "Encryption failed." : "Decryption failed.";
            break;
        }

        int outLen2 = 0;
        if (EVP_CipherFinal_ex(ctx, output.data() + outLen1, &outLen2) != 1) {
            result.error = encrypt ? "Encryption finalize failed." : "Decryption finalize failed.";
            break;
        }

        output.resize(static_cast<size_t>(outLen1 + outLen2));
        result.bytes = std::move(output);
        result.ok = true;
        ok = true;
    } while (false);

    EVP_CIPHER_CTX_free(ctx);
    if (!ok && result.error.empty()) {
        result.error = "Crypto operation failed.";
    }
    return result;
}
