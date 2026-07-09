#pragma once

#include <string>
#include <vector>

struct PinBlockResult {
    bool ok = false;
    std::string error;
    std::string pin;
    std::vector<unsigned char> bytes;
};

namespace pinblock {

PinBlockResult createIso0(const std::string& pin, const std::string& pan);
PinBlockResult decodeIso0(const std::vector<unsigned char>& block, const std::string& pan);

} // namespace pinblock
