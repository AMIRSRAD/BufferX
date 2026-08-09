#include "BankingTools.h"

#include "Crypto.h"
#include "Hex.h"

#include <openssl/evp.h>
#include <openssl/rand.h>

#include <algorithm>
#include <cctype>
#include <iomanip>
#include <memory>
#include <sstream>
#include <vector>

#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#endif

namespace {

std::string normalize(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    value.erase(std::remove_if(value.begin(), value.end(), [](unsigned char ch) {
        return ch == ' ' || ch == '-' || ch == '_';
    }), value.end());
    return value;
}

BankingToolResult fail(const std::string& error) {
    BankingToolResult result;
    result.error = error;
    return result;
}

BankingToolResult success(const std::string& output) {
    BankingToolResult result;
    result.ok = true;
    result.output = output;
    return result;
}

bool digitsOnly(const std::string& value) {
    return !value.empty() && std::all_of(value.begin(), value.end(), [](unsigned char ch) {
        return std::isdigit(ch) != 0;
    });
}

int bitCount(unsigned char value) {
    int count = 0;
    while (value != 0) {
        count += value & 1U;
        value >>= 1U;
    }
    return count;
}

BankingToolResult encodeBcd(const std::string& input, bool padLeft) {
    if (!digitsOnly(input)) {
        return fail("BCD input must contain digits only.");
    }
    std::string digits = input;
    if ((digits.size() % 2) != 0) {
        if (padLeft) {
            digits.insert(digits.begin(), '0');
        } else {
            digits.push_back('F');
        }
    }
    std::vector<unsigned char> bytes;
    bytes.reserve(digits.size() / 2);
    for (size_t i = 0; i < digits.size(); i += 2) {
        const unsigned char high = static_cast<unsigned char>(digits[i] - '0');
        const unsigned char low = digits[i + 1] == 'F' ? 0x0F : static_cast<unsigned char>(digits[i + 1] - '0');
        bytes.push_back(static_cast<unsigned char>((high << 4) | low));
    }
    return success(toHex(bytes, true));
}

BankingToolResult decodeBcd(const std::string& input, int digitCount, bool padLeft) {
    const HexParseResult parsed = fromHex(input);
    if (!parsed.ok) {
        return fail(parsed.error);
    }
    std::string digits;
    digits.reserve(parsed.bytes.size() * 2);
    for (unsigned char byte : parsed.bytes) {
        const int high = (byte >> 4) & 0x0F;
        const int low = byte & 0x0F;
        if (high > 9 || low > 0x0F) {
            return fail("Invalid BCD nibble.");
        }
        digits.push_back(static_cast<char>('0' + high));
        digits.push_back(low <= 9 ? static_cast<char>('0' + low) : 'F');
    }
    if (digitCount > 0) {
        if (static_cast<size_t>(digitCount) > digits.size()) {
            return fail("Digit count exceeds BCD data.");
        }
        if (padLeft && (digitCount % 2) != 0) {
            digits.erase(digits.begin());
        }
        digits.resize(static_cast<size_t>(digitCount));
    } else if (!digits.empty() && digits.back() == 'F') {
        digits.pop_back();
    }
    return success(digits);
}

BankingToolResult xorHex(const std::string& left, const std::string& right) {
    const HexParseResult a = fromHex(left);
    const HexParseResult b = fromHex(right);
    if (!a.ok) return fail("First value: " + a.error);
    if (!b.ok) return fail("Second value: " + b.error);
    if (a.bytes.size() != b.bytes.size()) {
        return fail("XOR values must have the same byte length.");
    }
    std::vector<unsigned char> output(a.bytes.size());
    for (size_t i = 0; i < output.size(); ++i) {
        output[i] = static_cast<unsigned char>(a.bytes[i] ^ b.bytes[i]);
    }
    return success(toHex(output, true));
}

BankingToolResult base64Encode(const std::string& input, bool hexInput) {
    std::vector<unsigned char> bytes;
    if (hexInput) {
        const HexParseResult parsed = fromHex(input);
        if (!parsed.ok) return fail(parsed.error);
        bytes = parsed.bytes;
    } else {
        bytes.assign(input.begin(), input.end());
    }
    if (bytes.empty()) return success("");
    std::string output(4 * ((bytes.size() + 2) / 3), '\0');
    const int length = EVP_EncodeBlock(reinterpret_cast<unsigned char*>(output.data()),
                                       bytes.data(), static_cast<int>(bytes.size()));
    output.resize(static_cast<size_t>(length));
    return success(output);
}

BankingToolResult base64Decode(const std::string& input, bool hexOutput) {
    std::string compact;
    for (unsigned char ch : input) {
        if (!std::isspace(ch)) compact.push_back(static_cast<char>(ch));
    }
    if (compact.empty()) return success("");
    if ((compact.size() % 4) != 0) return fail("Invalid Base64 length.");
    std::vector<unsigned char> output((compact.size() / 4) * 3);
    int length = EVP_DecodeBlock(output.data(),
                                 reinterpret_cast<const unsigned char*>(compact.data()),
                                 static_cast<int>(compact.size()));
    if (length < 0) return fail("Invalid Base64 input.");
    if (!compact.empty() && compact.back() == '=') --length;
    if (compact.size() > 1 && compact[compact.size() - 2] == '=') --length;
    output.resize(static_cast<size_t>(length));
    if (hexOutput) return success(toHex(output, true));
    return success(std::string(output.begin(), output.end()));
}

const EVP_MD* digestFor(const std::string& operation) {
    if (operation == "md5") return EVP_md5();
    if (operation == "sha1") return EVP_sha1();
    if (operation == "sha256") return EVP_sha256();
    if (operation == "sha512") return EVP_sha512();
    return nullptr;
}

BankingToolResult hashValue(const std::string& operation, const std::string& input, bool hexInput) {
    std::vector<unsigned char> bytes;
    if (hexInput) {
        const HexParseResult parsed = fromHex(input);
        if (!parsed.ok) return fail(parsed.error);
        bytes = parsed.bytes;
    } else {
        bytes.assign(input.begin(), input.end());
    }
    const EVP_MD* digest = digestFor(operation);
    if (!digest) return fail("Unsupported hash algorithm.");
    std::vector<unsigned char> output(static_cast<size_t>(EVP_MD_size(digest)));
    unsigned int outputLength = 0;
    if (EVP_Digest(bytes.data(), bytes.size(), output.data(), &outputLength, digest, nullptr) != 1) {
        return fail("Hash calculation failed.");
    }
    output.resize(outputLength);
    return success(toHex(output, true));
}

int luhnCheckDigit(const std::string& body) {
    int sum = 0;
    bool doubleDigit = true;
    for (auto it = body.rbegin(); it != body.rend(); ++it) {
        int digit = *it - '0';
        if (doubleDigit) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
        doubleDigit = !doubleDigit;
    }
    return (10 - (sum % 10)) % 10;
}

BankingToolResult luhn(const std::string& operation, const std::string& input) {
    if (!digitsOnly(input)) return fail("PAN input must contain digits only.");
    if (operation == "luhngenerate") {
        return success(input + static_cast<char>('0' + luhnCheckDigit(input)));
    }
    if (input.size() < 2) return fail("PAN is too short.");
    const bool valid = luhnCheckDigit(input.substr(0, input.size() - 1)) == input.back() - '0';
    return success(valid ? "VALID" : "INVALID");
}

BankingToolResult keyParity(const std::string& operation, const std::string& input) {
    const HexParseResult parsed = fromHex(input);
    if (!parsed.ok) return fail(parsed.error);
    if (parsed.bytes.empty()) return fail("Key is empty.");
    std::vector<unsigned char> bytes = parsed.bytes;
    bool valid = true;
    for (unsigned char& byte : bytes) {
        if ((bitCount(byte) % 2) == 0) valid = false;
        if (operation == "adjustoddparity") {
            byte = static_cast<unsigned char>(byte & 0xFE);
            if ((bitCount(byte) % 2) == 0) byte |= 0x01;
        }
    }
    if (operation == "checkoddparity") return success(valid ? "VALID" : "INVALID");
    return success(toHex(bytes, true));
}

BankingToolResult randomKey(int bytes) {
    if (bytes != 8 && bytes != 16 && bytes != 24 && bytes != 32) {
        return fail("Key size must be 8, 16, 24, or 32 bytes.");
    }
    std::vector<unsigned char> key(static_cast<size_t>(bytes));
    if (RAND_bytes(key.data(), bytes) != 1) return fail("Secure random generation failed.");
    for (unsigned char& byte : key) {
        byte = static_cast<unsigned char>(byte & 0xFE);
        if ((bitCount(byte) % 2) == 0) byte |= 0x01;
    }
    return success(toHex(key, true));
}

BankingToolResult calculateKcv(const std::string& input, int outputBytes) {
    const HexParseResult parsed = fromHex(input);
    if (!parsed.ok) return fail(parsed.error);
    std::string algorithm;
    size_t blockSize = 8;
    if (parsed.bytes.size() == 8) algorithm = "des-ecb";
    else if (parsed.bytes.size() == 16 || parsed.bytes.size() == 24) algorithm = "3des-ecb";
    else if (parsed.bytes.size() == 32) {
        algorithm = "aes-256-ecb";
        blockSize = 16;
    } else return fail("KCV key must be 8, 16, 24, or 32 bytes.");

    const CryptoResult encrypted = CryptoEngine::transform(algorithm,
                                                            true,
                                                            std::vector<unsigned char>(blockSize, 0),
                                                            input,
                                                            std::string(),
                                                            false);
    if (!encrypted.ok) return fail(encrypted.error);
    const int take = outputBytes > 0 ? std::min(outputBytes, static_cast<int>(encrypted.bytes.size())) : 3;
    return success(toHex(std::vector<unsigned char>(encrypted.bytes.begin(), encrypted.bytes.begin() + take), true));
}

#ifdef _WIN32
BankingToolResult asciiEbcdic(const std::string& operation, const std::string& input) {
    if (operation == "asciitoebcdic") {
        const int wideLength = MultiByteToWideChar(20127, MB_ERR_INVALID_CHARS, input.data(),
                                                   static_cast<int>(input.size()), nullptr, 0);
        if (wideLength <= 0) return fail("Input is not ASCII.");
        std::wstring wide(static_cast<size_t>(wideLength), L'\0');
        MultiByteToWideChar(20127, MB_ERR_INVALID_CHARS, input.data(), static_cast<int>(input.size()),
                            wide.data(), wideLength);
        const int byteLength = WideCharToMultiByte(37, WC_NO_BEST_FIT_CHARS, wide.data(), wideLength,
                                                   nullptr, 0, nullptr, nullptr);
        if (byteLength <= 0) return fail("EBCDIC code page 37 is unavailable.");
        std::vector<unsigned char> bytes(static_cast<size_t>(byteLength));
        WideCharToMultiByte(37, WC_NO_BEST_FIT_CHARS, wide.data(), wideLength,
                            reinterpret_cast<char*>(bytes.data()), byteLength, nullptr, nullptr);
        return success(toHex(bytes, true));
    }
    const HexParseResult parsed = fromHex(input);
    if (!parsed.ok) return fail(parsed.error);
    const int wideLength = MultiByteToWideChar(37, 0, reinterpret_cast<const char*>(parsed.bytes.data()),
                                               static_cast<int>(parsed.bytes.size()), nullptr, 0);
    if (wideLength <= 0) return fail("EBCDIC code page 37 is unavailable.");
    std::wstring wide(static_cast<size_t>(wideLength), L'\0');
    MultiByteToWideChar(37, 0, reinterpret_cast<const char*>(parsed.bytes.data()),
                        static_cast<int>(parsed.bytes.size()), wide.data(), wideLength);
    const int byteLength = WideCharToMultiByte(CP_UTF8, 0, wide.data(), wideLength, nullptr, 0, nullptr, nullptr);
    std::string output(static_cast<size_t>(byteLength), '\0');
    WideCharToMultiByte(CP_UTF8, 0, wide.data(), wideLength, output.data(), byteLength, nullptr, nullptr);
    return success(output);
}
#endif

} // namespace

namespace bankingtools {

BankingToolResult run(const std::string& operationName,
                      const std::string& input,
                      const std::string& secondary,
                      int parameter) {
    const std::string operation = normalize(operationName);
    if (operation == "bcdencodeleft") return encodeBcd(input, true);
    if (operation == "bcdencoderight") return encodeBcd(input, false);
    if (operation == "bcddecodeleft") return decodeBcd(input, parameter, true);
    if (operation == "bcddecoderight") return decodeBcd(input, parameter, false);
    if (operation == "xorhex") return xorHex(input, secondary);
    if (operation == "base64encodetext") return base64Encode(input, false);
    if (operation == "base64encodehex") return base64Encode(input, true);
    if (operation == "base64decodetext") return base64Decode(input, false);
    if (operation == "base64decodehex") return base64Decode(input, true);
    if (operation == "md5" || operation == "sha1" || operation == "sha256" || operation == "sha512") {
        return hashValue(operation, input, secondary == "hex");
    }
    if (operation == "luhncheck" || operation == "luhngenerate") return luhn(operation, input);
    if (operation == "adjustoddparity" || operation == "checkoddparity") return keyParity(operation, input);
    if (operation == "randomkey") return randomKey(parameter);
    if (operation == "kcv") return calculateKcv(input, parameter);
#ifdef _WIN32
    if (operation == "asciitoebcdic" || operation == "ebcdictoascii") return asciiEbcdic(operation, input);
#endif
    return fail("Unsupported banking utility operation.");
}

} // namespace bankingtools
