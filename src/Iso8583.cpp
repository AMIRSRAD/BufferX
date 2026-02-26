#include "Iso8583.h"

#include "Hex.h"

#include <cctype>

namespace {
bool parseAsciiLength(const std::vector<unsigned char>& data,
                      size_t offset,
                      int digits,
                      size_t& value,
                      std::string& error) {
    if (digits <= 0) {
        error = "Length header digits must be positive.";
        return false;
    }
    if (offset + static_cast<size_t>(digits) > data.size()) {
        error = "Length header exceeds buffer.";
        return false;
    }
    size_t result = 0;
    for (int i = 0; i < digits; ++i) {
        unsigned char ch = data[offset + i];
        if (!std::isdigit(ch)) {
            error = "Length header is not numeric.";
            return false;
        }
        result = (result * 10) + (ch - '0');
    }
    value = result;
    return true;
}

bool parseBinaryLength(const std::vector<unsigned char>& data,
                       size_t offset,
                       int bytes,
                       size_t& value,
                       std::string& error) {
    if (bytes <= 0) {
        error = "Binary length header size must be positive.";
        return false;
    }
    if (offset + static_cast<size_t>(bytes) > data.size()) {
        error = "Binary length header exceeds buffer.";
        return false;
    }
    size_t result = 0;
    for (int i = 0; i < bytes; ++i) {
        result = (result << 8) | data[offset + i];
    }
    value = result;
    return true;
}

bool appendAsciiLength(std::vector<unsigned char>& out,
                       size_t length,
                       int digits,
                       std::string& error) {
    if (digits <= 0) {
        error = "Length digits must be positive.";
        return false;
    }
    size_t limit = 1;
    for (int i = 0; i < digits; ++i) {
        limit *= 10;
    }
    if (length >= limit) {
        error = "Message length exceeds ASCII length header capacity.";
        return false;
    }
    std::string lenStr = std::to_string(length);
    if (lenStr.size() < static_cast<size_t>(digits)) {
        lenStr.insert(lenStr.begin(), digits - lenStr.size(), '0');
    }
    out.insert(out.end(), lenStr.begin(), lenStr.end());
    return true;
}

bool buildAsciiLengthPrefix(size_t length,
                            int digits,
                            std::vector<unsigned char>& prefix,
                            std::string& error) {
    if (digits <= 0) {
        error = "Length digits must be positive.";
        return false;
    }
    size_t limit = 1;
    for (int i = 0; i < digits; ++i) {
        limit *= 10;
    }
    if (length >= limit) {
        error = "Message length exceeds ASCII length header capacity.";
        return false;
    }
    std::string lenStr = std::to_string(length);
    if (lenStr.size() < static_cast<size_t>(digits)) {
        lenStr.insert(lenStr.begin(), digits - lenStr.size(), '0');
    }
    prefix.assign(lenStr.begin(), lenStr.end());
    return true;
}

bool buildBinaryLengthPrefix(size_t length,
                             int bytes,
                             std::vector<unsigned char>& prefix,
                             std::string& error) {
    if (bytes <= 0) {
        error = "Binary length header size must be positive.";
        return false;
    }
    size_t limit = 1;
    for (int i = 0; i < bytes; ++i) {
        limit <<= 8;
    }
    if (length >= limit) {
        error = "Message length exceeds binary header capacity.";
        return false;
    }
    prefix.clear();
    prefix.reserve(bytes);
    for (int i = bytes - 1; i >= 0; --i) {
        prefix.push_back(static_cast<unsigned char>((length >> (i * 8)) & 0xFF));
    }
    return true;
}

bool readFixedField(const std::vector<unsigned char>& data,
                    size_t& offset,
                    int length,
                    std::vector<unsigned char>& out,
                    std::string& error) {
    if (length <= 0) {
        error = "Field length must be positive.";
        return false;
    }
    if (offset + static_cast<size_t>(length) > data.size()) {
        error = "Field data exceeds buffer.";
        return false;
    }
    out.assign(data.begin() + static_cast<long long>(offset),
               data.begin() + static_cast<long long>(offset + length));
    offset += static_cast<size_t>(length);
    return true;
}

bool readHexChars(const std::vector<unsigned char>& data,
                  size_t& offset,
                  int hexChars,
                  std::vector<unsigned char>& out,
                  std::string& error) {
    if (hexChars <= 0 || (hexChars % 2 != 0)) {
        error = "Hex field length must be a positive even number.";
        return false;
    }
    if (offset + static_cast<size_t>(hexChars) > data.size()) {
        error = "Hex field exceeds buffer.";
        return false;
    }
    std::string hexText;
    hexText.reserve(static_cast<size_t>(hexChars));
    for (int i = 0; i < hexChars; ++i) {
        hexText.push_back(static_cast<char>(data[offset + static_cast<size_t>(i)]));
    }
    HexParseResult parsed = fromHex(hexText);
    if (!parsed.ok) {
        error = parsed.error;
        return false;
    }
    out.assign(parsed.bytes.begin(), parsed.bytes.end());
    offset += static_cast<size_t>(hexChars);
    return true;
}

bool readVariableField(const std::vector<unsigned char>& data,
                       size_t& offset,
                       int digits,
                       int maxLength,
                       std::vector<unsigned char>& out,
                       std::string& error) {
    size_t len = 0;
    if (!parseAsciiLength(data, offset, digits, len, error)) {
        return false;
    }
    offset += static_cast<size_t>(digits);
    if (maxLength > 0 && static_cast<int>(len) > maxLength) {
        error = "Field length exceeds declared maximum.";
        return false;
    }
    if (offset + len > data.size()) {
        error = "Field data exceeds buffer.";
        return false;
    }
    out.assign(data.begin() + static_cast<long long>(offset),
               data.begin() + static_cast<long long>(offset + len));
    offset += len;
    return true;
}

std::vector<bool> bitmapToBits(const std::vector<unsigned char>& bitmapBytes) {
    std::vector<bool> bits(bitmapBytes.size() * 8 + 1, false);
    for (size_t i = 0; i < bitmapBytes.size(); ++i) {
        for (int bit = 0; bit < 8; ++bit) {
            bool set = (bitmapBytes[i] & (1 << (7 - bit))) != 0;
            bits[i * 8 + bit + 1] = set;
        }
    }
    return bits;
}

std::vector<unsigned char> buildBitmap(const std::map<int, std::string>& fields,
                                       bool& hasSecondary) {
    hasSecondary = false;
    for (const auto& entry : fields) {
        if (entry.first >= 65) {
            hasSecondary = true;
            break;
        }
    }
    const size_t size = hasSecondary ? 16 : 8;
    std::vector<unsigned char> bitmap(size, 0);
    if (hasSecondary) {
        bitmap[0] |= 0x80;
    }
    for (const auto& entry : fields) {
        const int fieldId = entry.first;
        if (fieldId <= 1) {
            continue;
        }
        const int bitIndex = fieldId - 1;
        const int byteIndex = bitIndex / 8;
        const int bitOffset = bitIndex % 8;
        if (byteIndex >= static_cast<int>(bitmap.size())) {
            continue;
        }
        bitmap[byteIndex] |= static_cast<unsigned char>(1 << (7 - bitOffset));
    }
    return bitmap;
}

std::vector<unsigned char> toAsciiBytes(const std::string& text) {
    return std::vector<unsigned char>(text.begin(), text.end());
}

bool isBinaryType(FieldType type) {
    return type == FieldType::BinaryFixed || type == FieldType::BinaryLl ||
           type == FieldType::BinaryLll;
}

} // namespace

DecodeResult Iso8583Codec::decode(const std::vector<unsigned char>& data,
                                  const Packager& packager,
                                  const DecodeOptions& options) {
    DecodeResult result;
    size_t offset = 0;
    size_t messageLength = data.size();
    std::vector<unsigned char> buffer = data;
    result.messageLength = data.size();

    if (options.header.enabled) {
        std::string error;
        if (options.autoDetectHeader) {
            if (options.header.size <= 0) {
                result.ok = false;
                result.error = "Length header size must be positive for auto-detect.";
                return result;
            }
            bool detected = false;
            size_t declaredLength = 0;
            size_t headerSize = static_cast<size_t>(options.header.size);
            if (parseAsciiLength(data, offset, options.header.size, declaredLength, error) &&
                headerSize + declaredLength == data.size()) {
                detected = true;
                result.headerFormat = LengthFormat::AsciiDigits;
            } else if (parseBinaryLength(data, offset, options.header.size, declaredLength, error) &&
                       headerSize + declaredLength == data.size()) {
                detected = true;
                result.headerFormat = LengthFormat::BinaryBigEndian;
            }
            if (detected) {
                result.headerDetected = true;
                result.headerSize = options.header.size;
                messageLength = declaredLength;
                offset += headerSize;
                buffer.assign(data.begin() + static_cast<long long>(offset),
                              data.begin() + static_cast<long long>(offset + messageLength));
                offset = 0;
                result.messageLength = messageLength;
            }
        } else {
            if (options.header.format == LengthFormat::AsciiDigits) {
                if (!parseAsciiLength(data, offset, options.header.size, messageLength, error)) {
                    result.ok = false;
                    result.error = error;
                    return result;
                }
                result.headerFormat = LengthFormat::AsciiDigits;
            } else if (options.header.format == LengthFormat::BinaryBigEndian) {
                if (!parseBinaryLength(data, offset, options.header.size, messageLength, error)) {
                    result.ok = false;
                    result.error = error;
                    return result;
                }
                result.headerFormat = LengthFormat::BinaryBigEndian;
            }
            offset += static_cast<size_t>(options.header.size);
            if (offset + messageLength > data.size()) {
                result.ok = false;
                result.error = "Declared length exceeds buffer size.";
                return result;
            }
            result.headerDetected = true;
            result.headerSize = options.header.size;
            buffer.assign(data.begin() + static_cast<long long>(offset),
                          data.begin() + static_cast<long long>(offset + messageLength));
            offset = 0;
            result.messageLength = messageLength;
        }
    }

    int mtiLength = 4;
    auto mtiIt = packager.fields.find(0);
    if (mtiIt != packager.fields.end() && mtiIt->second.length > 0) {
        mtiLength = mtiIt->second.length;
    }

    std::vector<unsigned char> mtiBytes;
    std::string error;
    if (!readFixedField(buffer, offset, mtiLength, mtiBytes, error)) {
        result.ok = false;
        result.error = "MTI: " + error;
        return result;
    }
    result.fields[0] = std::string(mtiBytes.begin(), mtiBytes.end());

    std::vector<unsigned char> bitmapBytes;
    bool hasSecondary = false;
    if (!readHexChars(buffer, offset, 16, bitmapBytes, error)) {
        result.ok = false;
        result.error = "Bitmap: " + error;
        return result;
    }
    hasSecondary = (bitmapBytes[0] & 0x80) != 0;
    if (hasSecondary) {
        std::vector<unsigned char> secondaryBytes;
        if (!readHexChars(buffer, offset, 16, secondaryBytes, error)) {
            result.ok = false;
            result.error = "Secondary bitmap: " + error;
            return result;
        }
        bitmapBytes.insert(bitmapBytes.end(), secondaryBytes.begin(), secondaryBytes.end());
    }

    std::vector<bool> bits = bitmapToBits(bitmapBytes);
    const int maxField = static_cast<int>(bits.size() - 1);
    for (int fieldId = 2; fieldId <= maxField; ++fieldId) {
        if (!bits[fieldId]) {
            continue;
        }
        auto defIt = packager.fields.find(fieldId);
        if (defIt == packager.fields.end()) {
            result.ok = false;
            result.error = "Missing definition for field " + std::to_string(fieldId) + ".";
            return result;
        }

        const FieldDef& def = defIt->second;
        std::vector<unsigned char> fieldBytes;
        if (def.variable) {
            if (isBinaryType(def.type)) {
                size_t len = 0;
                if (!parseAsciiLength(buffer, offset, def.lengthDigits, len, error)) {
                    result.ok = false;
                    result.error = "Field " + std::to_string(fieldId) + ": " + error;
                    return result;
                }
                offset += static_cast<size_t>(def.lengthDigits);
                if (def.length > 0 && static_cast<int>(len) > def.length) {
                    result.ok = false;
                    result.error = "Field " + std::to_string(fieldId) + " exceeds max length.";
                    return result;
                }
                const int hexChars = static_cast<int>(len * 2);
                if (!readHexChars(buffer, offset, hexChars, fieldBytes, error)) {
                    result.ok = false;
                    result.error = "Field " + std::to_string(fieldId) + ": " + error;
                    return result;
                }
            } else {
                if (!readVariableField(buffer, offset, def.lengthDigits, def.length, fieldBytes, error)) {
                    result.ok = false;
                    result.error = "Field " + std::to_string(fieldId) + ": " + error;
                    return result;
                }
            }
        } else {
            if (isBinaryType(def.type)) {
                const int hexChars = def.length * 2;
                if (!readHexChars(buffer, offset, hexChars, fieldBytes, error)) {
                    result.ok = false;
                    result.error = "Field " + std::to_string(fieldId) + ": " + error;
                    return result;
                }
            } else {
                if (!readFixedField(buffer, offset, def.length, fieldBytes, error)) {
                    result.ok = false;
                    result.error = "Field " + std::to_string(fieldId) + ": " + error;
                    return result;
                }
            }
        }

        if (isBinaryType(def.type)) {
            result.fields[fieldId] = toHex(fieldBytes, true);
        } else {
            std::string value(fieldBytes.begin(), fieldBytes.end());
            result.fields[fieldId] = value;
        }
    }

    result.ok = true;
    return result;
}

EncodeResult Iso8583Codec::encode(const std::map<int, std::string>& fields,
                                  const Packager& packager,
                                  const EncodeOptions& options) {
    EncodeResult result;
    std::string error;

    auto mtiIt = fields.find(0);
    if (mtiIt == fields.end()) {
        result.ok = false;
        result.error = "Field 0 (MTI) is required.";
        return result;
    }

    int mtiLength = 4;
    auto mtiDefIt = packager.fields.find(0);
    if (mtiDefIt != packager.fields.end() && mtiDefIt->second.length > 0) {
        mtiLength = mtiDefIt->second.length;
    }

    std::vector<unsigned char> message;
    std::vector<unsigned char> mtiBytes = toAsciiBytes(mtiIt->second);
    if (static_cast<int>(mtiBytes.size()) != mtiLength) {
        if (static_cast<int>(mtiBytes.size()) > mtiLength) {
            result.ok = false;
            result.error = "MTI length exceeds field definition.";
            return result;
        }
        mtiBytes.insert(mtiBytes.begin(), mtiLength - mtiBytes.size(), '0');
    }
    message.insert(message.end(), mtiBytes.begin(), mtiBytes.end());

    bool hasSecondary = false;
    std::vector<unsigned char> bitmap = buildBitmap(fields, hasSecondary);
    std::string bitmapHex = toHex(bitmap, true);
    message.insert(message.end(), bitmapHex.begin(), bitmapHex.end());

    const int maxField = packager.fieldCount > 0 ? packager.fieldCount : 128;
    for (int fieldId = 2; fieldId <= maxField; ++fieldId) {
        auto valueIt = fields.find(fieldId);
        if (valueIt == fields.end()) {
            continue;
        }
        auto defIt = packager.fields.find(fieldId);
        if (defIt == packager.fields.end()) {
            result.ok = false;
            result.error = "Missing definition for field " + std::to_string(fieldId) + ".";
            return result;
        }
        const FieldDef& def = defIt->second;
        std::vector<unsigned char> fieldBytes;
        std::vector<unsigned char> wireBytes;

        if (isBinaryType(def.type)) {
            HexParseResult hex = fromHex(valueIt->second);
            if (!hex.ok) {
                result.ok = false;
                result.error = "Field " + std::to_string(fieldId) + ": " + hex.error;
                return result;
            }
            if (def.variable) {
                if (def.length > 0 && static_cast<int>(hex.bytes.size()) > def.length) {
                    result.ok = false;
                    result.error = "Field " + std::to_string(fieldId) + " exceeds max length.";
                    return result;
                }
            } else {
                if (static_cast<int>(hex.bytes.size()) != def.length) {
                    if (options.allowBinaryPadding && static_cast<int>(hex.bytes.size()) < def.length) {
                        hex.bytes.resize(static_cast<size_t>(def.length), 0x00);
                    } else {
                        result.ok = false;
                        result.error = "Field " + std::to_string(fieldId) + " binary length mismatch.";
                        return result;
                    }
                }
            }
            fieldBytes.assign(hex.bytes.begin(), hex.bytes.end());
            std::string hexText = toHex(fieldBytes, true);
            wireBytes.assign(hexText.begin(), hexText.end());
        } else {
            std::string textValue = valueIt->second;
            fieldBytes = toAsciiBytes(textValue);
            wireBytes = fieldBytes;
        }

        if (def.variable) {
            if (def.length > 0 && static_cast<int>(fieldBytes.size()) > def.length) {
                result.ok = false;
                result.error = "Field " + std::to_string(fieldId) + " exceeds max length.";
                return result;
            }
            if (isBinaryType(def.type)) {
                if (!appendAsciiLength(message, fieldBytes.size(), def.lengthDigits, error)) {
                    result.ok = false;
                    result.error = "Field " + std::to_string(fieldId) + ": " + error;
                    return result;
                }
            } else {
                if (!appendAsciiLength(message, wireBytes.size(), def.lengthDigits, error)) {
                    result.ok = false;
                    result.error = "Field " + std::to_string(fieldId) + ": " + error;
                    return result;
                }
            }
            message.insert(message.end(), wireBytes.begin(), wireBytes.end());
        } else {
            if (def.length <= 0) {
                result.ok = false;
                result.error = "Field " + std::to_string(fieldId) + " has invalid length.";
                return result;
            }

            if (isBinaryType(def.type)) {
                message.insert(message.end(), wireBytes.begin(), wireBytes.end());
                continue;
            } else if (def.type == FieldType::NumericFixed || def.type == FieldType::Amount) {
                if (static_cast<int>(fieldBytes.size()) > def.length) {
                    result.ok = false;
                    result.error = "Field " + std::to_string(fieldId) + " exceeds fixed length.";
                    return result;
                }
                fieldBytes.insert(fieldBytes.begin(), def.length - fieldBytes.size(), '0');
            } else if (def.type == FieldType::CharFixed) {
                if (static_cast<int>(fieldBytes.size()) > def.length) {
                    result.ok = false;
                    result.error = "Field " + std::to_string(fieldId) + " exceeds fixed length.";
                    return result;
                }
                fieldBytes.insert(fieldBytes.end(), def.length - fieldBytes.size(), ' ');
            }
            message.insert(message.end(), fieldBytes.begin(), fieldBytes.end());
        }
    }

    if (options.header.enabled) {
        std::vector<unsigned char> prefix;
        if (options.header.format == LengthFormat::AsciiDigits) {
            if (!buildAsciiLengthPrefix(message.size(), options.header.size, prefix, error)) {
                result.ok = false;
                result.error = error;
                return result;
            }
        } else if (options.header.format == LengthFormat::BinaryBigEndian) {
            if (!buildBinaryLengthPrefix(message.size(), options.header.size, prefix, error)) {
                result.ok = false;
                result.error = error;
                return result;
            }
        }
        prefix.insert(prefix.end(), message.begin(), message.end());
        result.bytes = std::move(prefix);
    } else {
        result.bytes = std::move(message);
    }

    result.ok = true;
    return result;
}
