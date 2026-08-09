#include "PinVerification.h"

#include "Crypto.h"
#include "Hex.h"

#include <algorithm>
#include <cctype>
#include <vector>

namespace {

PinVerificationResult fail(const std::string& error) {
    PinVerificationResult result;
    result.error = error;
    return result;
}

bool digits(const std::string& value) {
    return !value.empty() && std::all_of(value.begin(), value.end(), [](unsigned char ch) {
        return std::isdigit(ch) != 0;
    });
}

PinVerificationResult encryptValidation(const std::string& digits16, const std::string& keyHex) {
    if (digits16.size() != 16 || !digits(digits16)) return fail("Validation data must contain exactly 16 digits.");
    const HexParseResult validation = fromHex(digits16);
    if (!validation.ok) return fail(validation.error);
    const HexParseResult key = fromHex(keyHex);
    if (!key.ok) return fail(key.error);
    const std::string algorithm = key.bytes.size() == 8 ? "des-ecb"
                                : (key.bytes.size() == 16 || key.bytes.size() == 24) ? "3des-ecb" : "";
    if (algorithm.empty()) return fail("PVK must be 8, 16, or 24 bytes.");
    const CryptoResult encrypted = CryptoEngine::transform(algorithm, true, validation.bytes,
                                                            keyHex, std::string(), false);
    if (!encrypted.ok) return fail(encrypted.error);
    PinVerificationResult result;
    result.ok = true;
    result.value = toHex(encrypted.bytes, true);
    return result;
}

std::string visaDecimalize(const std::string& cryptogram) {
    std::string output;
    for (char ch : cryptogram) if (ch >= '0' && ch <= '9') output.push_back(ch);
    if (output.size() < 4) {
        for (char ch : cryptogram) {
            if (ch >= 'A' && ch <= 'F') output.push_back(static_cast<char>('0' + ch - 'A'));
        }
    }
    return output.substr(0, 4);
}

PinVerificationResult naturalPin(const std::string& validationData,
                                 const std::string& decimalizationTable,
                                 const std::string& pvkHex,
                                 size_t pinLength) {
    if (decimalizationTable.size() != 16 || !digits(decimalizationTable)) {
        return fail("Decimalization table must contain exactly 16 digits.");
    }
    if (pinLength < 4 || pinLength > 12) return fail("PIN length must be between 4 and 12 digits.");
    PinVerificationResult encrypted = encryptValidation(validationData, pvkHex);
    if (!encrypted.ok) return encrypted;
    std::string natural;
    natural.reserve(pinLength);
    for (char ch : encrypted.value) {
        const int nibble = ch <= '9' ? ch - '0' : ch - 'A' + 10;
        natural.push_back(decimalizationTable[static_cast<size_t>(nibble)]);
        if (natural.size() == pinLength) break;
    }
    encrypted.naturalPin = natural;
    return encrypted;
}

} // namespace

namespace pinverification {

PinVerificationResult visaPvv(const std::string& pin,
                              const std::string& pan,
                              const std::string& pvki,
                              const std::string& pvkHex) {
    if (pin.size() != 4 || !digits(pin)) return fail("Visa PVV requires a 4-digit PIN.");
    if (pan.size() < 12 || pan.size() > 19 || !digits(pan)) return fail("PAN must contain 12 to 19 digits.");
    if (pvki.size() != 1 || !digits(pvki)) return fail("PVKI must be one decimal digit.");
    const std::string panWithoutCheck = pan.substr(0, pan.size() - 1);
    const std::string tsp = panWithoutCheck.substr(panWithoutCheck.size() - 11) + pvki + pin;
    PinVerificationResult result = encryptValidation(tsp, pvkHex);
    if (!result.ok) return result;
    result.value = visaDecimalize(result.value);
    return result;
}

PinVerificationResult ibm3624Offset(const std::string& customerPin,
                                    const std::string& validationData,
                                    const std::string& decimalizationTable,
                                    const std::string& pvkHex) {
    if (!digits(customerPin) || customerPin.size() < 4 || customerPin.size() > 12) {
        return fail("Customer PIN must contain 4 to 12 digits.");
    }
    PinVerificationResult result = naturalPin(validationData, decimalizationTable, pvkHex, customerPin.size());
    if (!result.ok) return result;
    result.value.clear();
    for (size_t i = 0; i < customerPin.size(); ++i) {
        result.value.push_back(static_cast<char>('0' + (customerPin[i] - result.naturalPin[i] + 10) % 10));
    }
    return result;
}

PinVerificationResult verifyIbm3624(const std::string& customerPin,
                                    const std::string& offset,
                                    const std::string& validationData,
                                    const std::string& decimalizationTable,
                                    const std::string& pvkHex) {
    if (!digits(customerPin) || !digits(offset) || customerPin.size() != offset.size() ||
        customerPin.size() < 4 || customerPin.size() > 12) {
        return fail("Customer PIN and offset must be equal-length values of 4 to 12 digits.");
    }
    PinVerificationResult result = naturalPin(validationData, decimalizationTable, pvkHex, customerPin.size());
    if (!result.ok) return result;
    std::string expected;
    for (size_t i = 0; i < offset.size(); ++i) {
        expected.push_back(static_cast<char>('0' + (result.naturalPin[i] - '0' + offset[i] - '0') % 10));
    }
    result.value = expected == customerPin ? "VALID" : "INVALID";
    return result;
}

} // namespace pinverification
