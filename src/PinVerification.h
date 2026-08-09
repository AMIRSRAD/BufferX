#pragma once

#include <string>

struct PinVerificationResult {
    bool ok = false;
    std::string error;
    std::string value;
    std::string naturalPin;
};

namespace pinverification {

PinVerificationResult visaPvv(const std::string& pin,
                              const std::string& pan,
                              const std::string& pvki,
                              const std::string& pvkHex);
PinVerificationResult ibm3624Offset(const std::string& customerPin,
                                    const std::string& validationData,
                                    const std::string& decimalizationTable,
                                    const std::string& pvkHex);
PinVerificationResult verifyIbm3624(const std::string& customerPin,
                                    const std::string& offset,
                                    const std::string& validationData,
                                    const std::string& decimalizationTable,
                                    const std::string& pvkHex);

} // namespace pinverification
