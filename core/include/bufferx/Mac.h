#pragma once

#include <string>
#include <vector>

enum class MacPaddingMode {
    Iso9797Method1,
    Iso9797Method2
};

struct MacResult {
    bool ok = false;
    std::string error;
    std::vector<unsigned char> macBytes;
};

class MacEngine {
public:
    static MacResult calculateAnsiX919(const std::vector<unsigned char>& payload,
                                       const std::string& keyHex,
                                       MacPaddingMode paddingMode,
                                       int outputBytes);
};
