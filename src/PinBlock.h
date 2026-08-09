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
PinBlockResult createIso1(const std::string& pin);
PinBlockResult decodeIso1(const std::vector<unsigned char>& block);
PinBlockResult createIso3(const std::string& pin, const std::string& pan);
PinBlockResult decodeIso3(const std::vector<unsigned char>& block, const std::string& pan);
PinBlockResult encryptIso4(const std::string& pin, const std::string& pan, const std::string& keyHex);
PinBlockResult decryptIso4(const std::vector<unsigned char>& block,
                           const std::string& pan,
                           const std::string& keyHex);

} // namespace pinblock
