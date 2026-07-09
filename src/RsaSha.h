#pragma once

#include <string>

struct RsaShaResult {
    bool ok = false;
    bool verified = false;
    std::string error;
    std::string base64;
};

namespace rsasha {

RsaShaResult signBase64(const std::string& payload, const std::string& privateKeyPem, const std::string& digestName);
RsaShaResult verifyBase64(const std::string& payload,
                          const std::string& publicKeyPem,
                          const std::string& signatureBase64,
                          const std::string& digestName);

} // namespace rsasha
