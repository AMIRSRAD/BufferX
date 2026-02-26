#pragma once

#include <map>
#include <string>
#include <vector>

#include "Packager.h"

enum class LengthFormat {
    None,
    AsciiDigits,
    BinaryBigEndian
};

struct LengthHeader {
    bool enabled = false;
    LengthFormat format = LengthFormat::None;
    int size = 0;
};

struct DecodeOptions {
    LengthHeader header;
    bool autoDetectHeader = false;
};

struct EncodeOptions {
    LengthHeader header;
    bool autoDetectHeader = false;
    bool allowBinaryPadding = false;
    bool allowNumericSanitize = false;
};

struct DecodeResult {
    bool ok = false;
    std::string error;
    std::map<int, std::string> fields;
    bool headerDetected = false;
    LengthFormat headerFormat = LengthFormat::None;
    int headerSize = 0;
    size_t messageLength = 0;
};

struct EncodeResult {
    bool ok = false;
    std::string error;
    std::vector<unsigned char> bytes;
};

class Iso8583Codec {
public:
    static DecodeResult decode(const std::vector<unsigned char>& data,
                               const Packager& packager,
                               const DecodeOptions& options);

    static EncodeResult encode(const std::map<int, std::string>& fields,
                               const Packager& packager,
                               const EncodeOptions& options);
};
