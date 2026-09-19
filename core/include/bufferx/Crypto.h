#pragma once

#include <string>
#include <vector>

struct CryptoResult {
    bool ok = false;
    std::string error;
    std::vector<unsigned char> bytes;
};

class CryptoEngine {
public:
    static CryptoResult transform(const std::string& algorithm,
                                  bool encrypt,
                                  const std::vector<unsigned char>& input,
                                  const std::string& keyHex,
                                  const std::string& ivHex,
                                  bool usePadding);
};
