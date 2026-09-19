#pragma once

#include <string>

struct RsaShaResult {
    bool ok = false;
    bool verified = false;
    std::string error;
    std::string base64;
};

struct RsaCipherResult {
    bool ok = false;
    std::string error;
    std::string base64;
    std::string plaintext;
};

namespace rsasha {

RsaShaResult signBase64(const std::string& payload, const std::string& privateKeyPem, const std::string& digestName);
RsaShaResult verifyBase64(const std::string& payload,
                          const std::string& publicKeyPem,
                          const std::string& signatureBase64,
                          const std::string& digestName);
RsaCipherResult encryptBase64(const std::string& payload,
                              const std::string& publicKeyPem,
                              const std::string& paddingName);
RsaCipherResult decryptBase64(const std::string& ciphertextBase64,
                              const std::string& privateKeyPem,
                              const std::string& paddingName);

} // namespace rsasha
