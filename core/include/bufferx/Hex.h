#pragma once

#include <string>
#include <vector>

struct HexParseResult {
    bool ok = false;
    std::string error;
    std::vector<unsigned char> bytes;
};

HexParseResult fromHex(const std::string& text);
std::string toHex(const std::vector<unsigned char>& bytes, bool uppercase = true);
