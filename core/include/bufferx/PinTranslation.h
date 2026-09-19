#pragma once

#include <string>
#include <vector>

struct PinTranslationResult {
    bool ok = false;
    std::string error;
    std::string pin;
    std::vector<unsigned char> clearBlock;
    std::vector<unsigned char> translatedBlock;
};

namespace pintranslation {

PinTranslationResult createAtmClearBlock(const std::string& format,
                                         const std::string& pin,
                                         const std::string& pan,
                                         unsigned char iso1Filler = 0);
PinTranslationResult decodeAtmClearBlock(const std::string& format,
                                         const std::vector<unsigned char>& clearBlock,
                                         const std::string& pan);
PinTranslationResult translate(const std::vector<unsigned char>& encryptedBlock,
                               const std::string& pan,
                               const std::string& sourceFormat,
                               const std::string& sourceAlgorithm,
                               const std::string& sourceKeyHex,
                               const std::string& destinationFormat,
                               const std::string& destinationAlgorithm,
                               const std::string& destinationKeyHex);

} // namespace pintranslation
