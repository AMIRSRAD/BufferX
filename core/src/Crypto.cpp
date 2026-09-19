#include "bufferx/Crypto.h"

#include "bufferx/Hex.h"

#include <openssl/des.h>
#include <openssl/evp.h>

#include <algorithm>
#include <cctype>
#include <cstring>

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

std::vector<unsigned char> addPkcs7Padding(const std::vector<unsigned char>& input, size_t blockSize) {
    size_t pad = blockSize - (input.size() % blockSize);
    if (pad == 0) {
        pad = blockSize;
    }
    std::vector<unsigned char> padded = input;
    padded.insert(padded.end(), pad, static_cast<unsigned char>(pad));
    return padded;
}

bool stripPkcs7Padding(std::vector<unsigned char>& input, size_t blockSize, std::string& error) {
    if (input.empty() || (input.size() % blockSize) != 0) {
        error = "Invalid padded payload length.";
        return false;
    }
    const unsigned char pad = input.back();
    if (pad == 0 || pad > blockSize || pad > input.size()) {
        error = "Invalid PKCS#7 padding.";
        return false;
    }
    const size_t start = input.size() - pad;
    for (size_t i = start; i < input.size(); ++i) {
        if (input[i] != pad) {
            error = "Invalid PKCS#7 padding.";
            return false;
        }
    }
    input.resize(start);
    return true;
}

bool isDesFamily(const std::string& normalized) {
    return normalized == "desecb" || normalized == "descbc" || normalized == "3desecb" ||
           normalized == "desedeecb" || normalized == "tripledesecb" || normalized == "3descbc" ||
           normalized == "desedecbc" || normalized == "tripledescbc";
}

CryptoResult transformWithDes(const std::string& normalized,
                              bool encrypt,
                              const std::vector<unsigned char>& input,
                              const std::vector<unsigned char>& key,
                              const std::vector<unsigned char>& iv,
                              bool usePadding) {
    CryptoResult result;
    constexpr size_t kBlockSize = 8;
    std::vector<unsigned char> working = input;

    if (encrypt) {
        if (usePadding) {
            working = addPkcs7Padding(input, kBlockSize);
        } else if ((working.size() % kBlockSize) != 0) {
            result.error = "Input length must be a multiple of 8 bytes when padding is disabled.";
            return result;
        }
    } else if ((working.size() % kBlockSize) != 0) {
        result.error = "Encrypted payload length must be a multiple of 8 bytes.";
        return result;
    }

    result.bytes.resize(working.size());

    DES_cblock block1 {};
    DES_cblock block2 {};
    DES_cblock block3 {};
    std::memcpy(block1, key.data(), 8);
    DES_key_schedule ks1 {};
    DES_set_key_unchecked(&block1, &ks1);

    const bool tripleDes = normalized != "desecb" && normalized != "descbc";
    DES_key_schedule ks2 {};
    DES_key_schedule ks3 {};
    if (tripleDes) {
        std::memcpy(block2, key.data() + 8, 8);
        std::memcpy(block3, key.data() + 16, 8);
        DES_set_key_unchecked(&block2, &ks2);
        DES_set_key_unchecked(&block3, &ks3);
    }

    if (normalized == "desecb") {
        for (size_t offset = 0; offset < working.size(); offset += kBlockSize) {
            DES_ecb_encrypt(reinterpret_cast<const_DES_cblock*>(working.data() + offset),
                            reinterpret_cast<DES_cblock*>(result.bytes.data() + offset),
                            &ks1,
                            encrypt ? DES_ENCRYPT : DES_DECRYPT);
        }
    } else if (normalized == "descbc") {
        DES_cblock ivBlock {};
        std::memcpy(ivBlock, iv.data(), 8);
        DES_ncbc_encrypt(working.data(),
                         result.bytes.data(),
                         static_cast<long>(working.size()),
                         &ks1,
                         &ivBlock,
                         encrypt ? DES_ENCRYPT : DES_DECRYPT);
    } else if (normalized == "3desecb" || normalized == "desedeecb" || normalized == "tripledesecb") {
        for (size_t offset = 0; offset < working.size(); offset += kBlockSize) {
            DES_ecb3_encrypt(reinterpret_cast<const_DES_cblock*>(working.data() + offset),
                             reinterpret_cast<DES_cblock*>(result.bytes.data() + offset),
                             &ks1,
                             &ks2,
                             &ks3,
                             encrypt ? DES_ENCRYPT : DES_DECRYPT);
        }
    } else if (normalized == "3descbc" || normalized == "desedecbc" || normalized == "tripledescbc") {
        DES_cblock ivBlock {};
        std::memcpy(ivBlock, iv.data(), 8);
        DES_ede3_cbc_encrypt(working.data(),
                             result.bytes.data(),
                             static_cast<long>(working.size()),
                             &ks1,
                             &ks2,
                             &ks3,
                             &ivBlock,
                             encrypt ? DES_ENCRYPT : DES_DECRYPT);
    } else {
        result.error = "Unsupported DES algorithm.";
        return result;
    }

    if (!encrypt && usePadding) {
        if (!stripPkcs7Padding(result.bytes, kBlockSize, result.error)) {
            result.bytes.clear();
            return result;
        }
    }

    result.ok = true;
    return result;
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
    const std::string normalized = normalizeName(algorithm);

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

    if (isDesFamily(normalized)) {
        return transformWithDes(normalized, encrypt, input, key, iv, usePadding);
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
