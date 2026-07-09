#include "RsaSha.h"

#include <openssl/bio.h>
#include <openssl/evp.h>
#include <openssl/pem.h>

#include <algorithm>
#include <cctype>
#include <memory>
#include <vector>

namespace {

std::string normalizeDigestName(std::string value) {
    std::string normalized;
    normalized.reserve(value.size());
    for (unsigned char ch : value) {
        if (std::isalnum(ch)) {
            normalized.push_back(static_cast<char>(std::tolower(ch)));
        }
    }
    return normalized;
}

const EVP_MD* resolveDigest(const std::string& digestName) {
    const std::string normalized = normalizeDigestName(digestName);
    if (normalized == "sha1" || normalized == "rsasha1") {
        return EVP_sha1();
    }
    if (normalized == "sha256" || normalized == "rsasha256" || normalized == "rsasha") {
        return EVP_sha256();
    }
    if (normalized == "sha512" || normalized == "rsasha512") {
        return EVP_sha512();
    }
    return nullptr;
}

using BioPtr = std::unique_ptr<BIO, decltype(&BIO_free)>;
using PkeyPtr = std::unique_ptr<EVP_PKEY, decltype(&EVP_PKEY_free)>;
using MdCtxPtr = std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)>;

PkeyPtr loadPrivateKey(const std::string& pem, std::string& error) {
    BioPtr bio(BIO_new_mem_buf(pem.data(), static_cast<int>(pem.size())), &BIO_free);
    if (!bio) {
        error = "Failed to create BIO for private key.";
        return PkeyPtr(nullptr, &EVP_PKEY_free);
    }
    EVP_PKEY* raw = PEM_read_bio_PrivateKey(bio.get(), nullptr, nullptr, nullptr);
    if (!raw) {
        error = "Failed to read private key PEM.";
        return PkeyPtr(nullptr, &EVP_PKEY_free);
    }
    return PkeyPtr(raw, &EVP_PKEY_free);
}

PkeyPtr loadPublicKey(const std::string& pem, std::string& error) {
    BioPtr bio(BIO_new_mem_buf(pem.data(), static_cast<int>(pem.size())), &BIO_free);
    if (!bio) {
        error = "Failed to create BIO for public key.";
        return PkeyPtr(nullptr, &EVP_PKEY_free);
    }
    EVP_PKEY* raw = PEM_read_bio_PUBKEY(bio.get(), nullptr, nullptr, nullptr);
    if (!raw) {
        error = "Failed to read public key PEM.";
        return PkeyPtr(nullptr, &EVP_PKEY_free);
    }
    return PkeyPtr(raw, &EVP_PKEY_free);
}

std::string toBase64(const std::vector<unsigned char>& bytes, std::string& error) {
    if (bytes.empty()) {
        return {};
    }
    std::string out(static_cast<size_t>(4 * ((bytes.size() + 2) / 3)), '\0');
    const int produced = EVP_EncodeBlock(reinterpret_cast<unsigned char*>(out.data()), bytes.data(), static_cast<int>(bytes.size()));
    if (produced < 0) {
        error = "Base64 encoding failed.";
        return {};
    }
    out.resize(static_cast<size_t>(produced));
    return out;
}

std::vector<unsigned char> fromBase64(const std::string& text, std::string& error) {
    std::string compact;
    compact.reserve(text.size());
    for (unsigned char ch : text) {
        if (!std::isspace(ch)) {
            compact.push_back(static_cast<char>(ch));
        }
    }
    if (compact.empty()) {
        return {};
    }

    std::vector<unsigned char> out(compact.size(), 0);
    const int produced = EVP_DecodeBlock(out.data(),
                                         reinterpret_cast<const unsigned char*>(compact.data()),
                                         static_cast<int>(compact.size()));
    if (produced < 0) {
        error = "Invalid Base64 signature.";
        return {};
    }

    size_t decodedSize = static_cast<size_t>(produced);
    if (!compact.empty() && compact.back() == '=') {
        --decodedSize;
    }
    if (compact.size() > 1 && compact[compact.size() - 2] == '=') {
        --decodedSize;
    }
    out.resize(decodedSize);
    return out;
}

} // namespace

namespace rsasha {

RsaShaResult signBase64(const std::string& payload, const std::string& privateKeyPem, const std::string& digestName) {
    RsaShaResult result;
    const EVP_MD* digest = resolveDigest(digestName);
    if (!digest) {
        result.error = "Unsupported RSA-SHA digest.";
        return result;
    }

    std::string keyError;
    PkeyPtr privateKey = loadPrivateKey(privateKeyPem, keyError);
    if (!keyError.empty()) {
        result.error = keyError;
        return result;
    }

    MdCtxPtr ctx(EVP_MD_CTX_new(), &EVP_MD_CTX_free);
    if (!ctx) {
        result.error = "Failed to allocate digest context.";
        return result;
    }
    if (EVP_DigestSignInit(ctx.get(), nullptr, digest, nullptr, privateKey.get()) != 1) {
        result.error = "RSA-SHA sign init failed.";
        return result;
    }
    if (EVP_DigestSignUpdate(ctx.get(), payload.data(), payload.size()) != 1) {
        result.error = "RSA-SHA sign update failed.";
        return result;
    }

    size_t signatureSize = 0;
    if (EVP_DigestSignFinal(ctx.get(), nullptr, &signatureSize) != 1) {
        result.error = "RSA-SHA sign size calculation failed.";
        return result;
    }

    std::vector<unsigned char> signature(signatureSize, 0);
    if (EVP_DigestSignFinal(ctx.get(), signature.data(), &signatureSize) != 1) {
        result.error = "RSA-SHA signing failed.";
        return result;
    }
    signature.resize(signatureSize);

    std::string base64Error;
    result.base64 = toBase64(signature, base64Error);
    if (!base64Error.empty()) {
        result.error = base64Error;
        return result;
    }

    result.ok = true;
    return result;
}

RsaShaResult verifyBase64(const std::string& payload,
                          const std::string& publicKeyPem,
                          const std::string& signatureBase64,
                          const std::string& digestName) {
    RsaShaResult result;
    const EVP_MD* digest = resolveDigest(digestName);
    if (!digest) {
        result.error = "Unsupported RSA-SHA digest.";
        return result;
    }

    std::string keyError;
    PkeyPtr publicKey = loadPublicKey(publicKeyPem, keyError);
    if (!keyError.empty()) {
        result.error = keyError;
        return result;
    }

    std::string base64Error;
    const std::vector<unsigned char> signature = fromBase64(signatureBase64, base64Error);
    if (!base64Error.empty()) {
        result.error = base64Error;
        return result;
    }

    MdCtxPtr ctx(EVP_MD_CTX_new(), &EVP_MD_CTX_free);
    if (!ctx) {
        result.error = "Failed to allocate digest context.";
        return result;
    }
    if (EVP_DigestVerifyInit(ctx.get(), nullptr, digest, nullptr, publicKey.get()) != 1) {
        result.error = "RSA-SHA verify init failed.";
        return result;
    }
    if (EVP_DigestVerifyUpdate(ctx.get(), payload.data(), payload.size()) != 1) {
        result.error = "RSA-SHA verify update failed.";
        return result;
    }

    const int verifyResult = EVP_DigestVerifyFinal(ctx.get(), signature.data(), signature.size());
    if (verifyResult < 0) {
        result.error = "RSA-SHA verification failed.";
        return result;
    }

    result.ok = true;
    result.verified = verifyResult == 1;
    return result;
}

} // namespace rsasha
