#include "Iso8583.h"

#include "Hex.h"

#include <algorithm>
#include <cctype>
#include <cstdio>

namespace {
std::string formatContextBytes(const std::vector<unsigned char>& data, size_t offset, size_t count = 8) {
    if (offset >= data.size()) {
        return "EOF";
    }
    const size_t end = std::min(data.size(), offset + count);
    std::vector<unsigned char> slice(data.begin() + static_cast<long long>(offset),
                                     data.begin() + static_cast<long long>(end));
    return toHex(slice, true);
}

std::string formatDecodeError(const std::string& scope,
                              const std::vector<unsigned char>& data,
                              size_t offset,
                              const std::string& detail) {
    const size_t remaining = offset < data.size() ? (data.size() - offset) : 0;
    return scope + " at offset " + std::to_string(offset) + " (remaining " + std::to_string(remaining) +
           " bytes, context " + formatContextBytes(data, offset) + "): " + detail;
}

std::string formatEncodeInputError(const std::string& detail) {
    return "Input error: " + detail;
}

std::string formatPackagerError(const std::string& detail) {
    return "Packager definition error: " + detail;
}

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
        error = "Field data exceeds buffer (expected " + std::to_string(length) + " bytes).";
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
        error = "Hex field exceeds buffer (expected " + std::to_string(hexChars) + " hex chars).";
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
        error = "Field length exceeds declared maximum (declared " + std::to_string(len) + ", max " +
                std::to_string(maxLength) + ").";
        return false;
    }
    if (offset + len > data.size()) {
        error = "Field data exceeds buffer (declared " + std::to_string(len) + " bytes).";
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

std::vector<unsigned char> buildBitmap(const std::map<int, std::string>& fields, size_t size, bool setSecondaryBit) {
    std::vector<unsigned char> bitmap(size, 0);
    if (setSecondaryBit && !bitmap.empty()) {
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

std::vector<unsigned char> buildBitmapForPackager(const std::map<int, std::string>& fields,
                                                  const Packager& packager,
                                                  bool& hasSecondary) {
    hasSecondary = false;
    if (packager.bitmapIndex == 0) {
        const int bitCount = packager.fieldCount > 0 ? packager.fieldCount : 64;
        const size_t size = static_cast<size_t>((bitCount + 7) / 8);
        return buildBitmap(fields, size, false);
    }

    for (const auto& entry : fields) {
        if (entry.first >= 65) {
            hasSecondary = true;
            break;
        }
    }
    const size_t size = hasSecondary ? 16 : 8;
    return buildBitmap(fields, size, hasSecondary);
}

std::vector<unsigned char> toAsciiBytes(const std::string& text) {
    return std::vector<unsigned char>(text.begin(), text.end());
}

bool isNumericType(FieldType type) {
    return type == FieldType::NumericFixed || type == FieldType::Amount;
}

bool isBinaryType(FieldType type) {
    return type == FieldType::BinaryFixed || type == FieldType::BinaryLl ||
           type == FieldType::BinaryLll || type == FieldType::BinaryLlll;
}

std::vector<int> sortedFieldIds(const Packager& packager, bool includeBitmapFields) {
    std::vector<int> ids;
    ids.reserve(packager.fields.size());
    for (const auto& entry : packager.fields) {
        if (!includeBitmapFields && entry.second.type == FieldType::Bitmap) {
            continue;
        }
        ids.push_back(entry.first);
    }
    std::sort(ids.begin(), ids.end());
    return ids;
}

std::string sanitizeNumericText(const std::string& text) {
    std::string sanitized;
    sanitized.reserve(text.size());
    for (unsigned char ch : text) {
        if (std::isdigit(ch)) {
            sanitized.push_back(static_cast<char>(ch));
        }
    }
    return sanitized;
}

bool validateNumericText(const std::string& text) {
    for (unsigned char ch : text) {
        if (!std::isdigit(ch)) {
            return false;
        }
    }
    return true;
}

bool hasSourceType(const FieldDef& def, const char* prefix) {
    return def.sourceType.rfind(prefix, 0) == 0;
}

bool isLegacyIfb(const FieldDef& def, bool legacyEngine) {
    return legacyEngine && hasSourceType(def, "IFB_");
}

bool isLegacyIfbNumeric(const FieldDef& def, bool legacyEngine) {
    return isLegacyIfb(def, legacyEngine) &&
           (def.sourceType.find("NUMERIC") != std::string::npos ||
            def.sourceType.find("LLNUM") != std::string::npos);
}

bool isLegacyIfbBinary(const FieldDef& def, bool legacyEngine) {
    return isLegacyIfb(def, legacyEngine) && def.sourceType.find("BINARY") != std::string::npos;
}

bool packBcd(const std::string& digits,
             bool padLeft,
             unsigned char rightPadNibble,
             std::vector<unsigned char>& out,
             std::string& error) {
    if (!validateNumericText(digits)) {
        error = "BCD value contains non-numeric characters.";
        return false;
    }
    out.clear();
    out.reserve((digits.size() + 1) / 2);
    size_t index = 0;
    if ((digits.size() % 2) != 0 && padLeft) {
        out.push_back(static_cast<unsigned char>(digits[0] - '0'));
        index = 1;
    }
    while (index + 1 < digits.size()) {
        out.push_back(static_cast<unsigned char>(((digits[index] - '0') << 4) | (digits[index + 1] - '0')));
        index += 2;
    }
    if (index < digits.size()) {
        out.push_back(static_cast<unsigned char>(((digits[index] - '0') << 4) | rightPadNibble));
    }
    return true;
}

bool unpackBcd(const std::vector<unsigned char>& bytes,
               size_t digitCount,
               bool padLeft,
               std::string& value,
               std::string& error) {
    std::string all;
    all.reserve(bytes.size() * 2);
    for (unsigned char byte : bytes) {
        const unsigned char high = static_cast<unsigned char>((byte >> 4) & 0x0F);
        const unsigned char low = static_cast<unsigned char>(byte & 0x0F);
        if (high > 9 || (low > 9 && all.size() + 1 < digitCount)) {
            error = "Invalid packed BCD digit.";
            return false;
        }
        all.push_back(static_cast<char>('0' + high));
        if (low <= 9) {
            all.push_back(static_cast<char>('0' + low));
        } else {
            all.push_back('F');
        }
    }
    if ((digitCount % 2) != 0 && padLeft) {
        if (all.empty()) {
            error = "Packed BCD value is empty.";
            return false;
        }
        all.erase(all.begin());
    }
    if (all.size() < digitCount) {
        error = "Packed BCD value is shorter than declared length.";
        return false;
    }
    value = all.substr(0, digitCount);
    return true;
}

bool parsePackedDecimalLength(const std::vector<unsigned char>& data,
                              size_t offset,
                              int digits,
                              size_t& value,
                              size_t& consumed,
                              std::string& error) {
    consumed = static_cast<size_t>((digits + 1) / 2);
    if (digits <= 0 || offset + consumed > data.size()) {
        error = "Packed length prefix exceeds buffer.";
        return false;
    }
    std::vector<unsigned char> bytes(data.begin() + static_cast<long long>(offset),
                                     data.begin() + static_cast<long long>(offset + consumed));
    std::string text;
    if (!unpackBcd(bytes, static_cast<size_t>(digits), true, text, error)) {
        return false;
    }
    value = 0;
    for (char ch : text) {
        value = value * 10 + static_cast<size_t>(ch - '0');
    }
    return true;
}

bool appendPackedDecimalLength(std::vector<unsigned char>& out,
                               size_t length,
                               int digits,
                               std::string& error) {
    size_t limit = 1;
    for (int i = 0; i < digits; ++i) {
        limit *= 10;
    }
    if (digits <= 0 || length >= limit) {
        error = "Value exceeds packed length-prefix capacity.";
        return false;
    }
    std::string text = std::to_string(length);
    text.insert(text.begin(), static_cast<size_t>(digits) - text.size(), '0');
    std::vector<unsigned char> packed;
    if (!packBcd(text, true, 0, packed, error)) {
        return false;
    }
    out.insert(out.end(), packed.begin(), packed.end());
    return true;
}

bool decodeFieldValue(const std::vector<unsigned char>& buffer,
                      size_t& offset,
                      int fieldId,
                      const FieldDef& def,
                      bool legacyEngine,
                      std::string& value,
                      std::string& error) {
    const size_t fieldOffset = offset;
    std::vector<unsigned char> fieldBytes;

    if (legacyEngine && def.sourceType == "IFA_HHHHCHAR") {
        if (offset + 4 > buffer.size()) {
            error = formatDecodeError("Field " + std::to_string(fieldId), buffer, offset,
                                      "Hexadecimal length prefix exceeds buffer.");
            return false;
        }
        std::string lengthText(buffer.begin() + static_cast<long long>(offset),
                               buffer.begin() + static_cast<long long>(offset + 4));
        size_t length = 0;
        try {
            length = static_cast<size_t>(std::stoul(lengthText, nullptr, 16));
        } catch (...) {
            error = formatDecodeError("Field " + std::to_string(fieldId), buffer, offset,
                                      "Invalid hexadecimal length prefix.");
            return false;
        }
        offset += 4;
        if (length > static_cast<size_t>(def.length) || offset + length > buffer.size()) {
            error = formatDecodeError("Field " + std::to_string(fieldId), buffer, fieldOffset,
                                      "Declared hexadecimal length exceeds field or buffer.");
            return false;
        }
        value.assign(buffer.begin() + static_cast<long long>(offset),
                     buffer.begin() + static_cast<long long>(offset + length));
        offset += length;
        return true;
    }

    if (isLegacyIfb(def, legacyEngine)) {
        size_t logicalLength = static_cast<size_t>(def.length);
        if (def.variable) {
            size_t prefixBytes = 0;
            if (!parsePackedDecimalLength(buffer, offset, def.lengthDigits, logicalLength, prefixBytes, error)) {
                error = formatDecodeError("Field " + std::to_string(fieldId), buffer, fieldOffset, error);
                return false;
            }
            offset += prefixBytes;
            if (def.length > 0 && logicalLength > static_cast<size_t>(def.length)) {
                error = formatDecodeError("Field " + std::to_string(fieldId), buffer, fieldOffset,
                                          "Declared length exceeds maximum.");
                return false;
            }
        }
        if (isLegacyIfbNumeric(def, legacyEngine)) {
            const size_t byteLength = (logicalLength + 1) / 2;
            if (offset + byteLength > buffer.size()) {
                error = formatDecodeError("Field " + std::to_string(fieldId), buffer, offset,
                                          "Packed BCD field exceeds buffer.");
                return false;
            }
            fieldBytes.assign(buffer.begin() + static_cast<long long>(offset),
                              buffer.begin() + static_cast<long long>(offset + byteLength));
            offset += byteLength;
            const bool panRightPad = def.sourceType == "IFB_LLNUM_PAN_HC";
            if (!unpackBcd(fieldBytes, logicalLength, !panRightPad, value, error)) {
                error = formatDecodeError("Field " + std::to_string(fieldId), buffer, fieldOffset, error);
                return false;
            }
            return true;
        }
        if (offset + logicalLength > buffer.size()) {
            error = formatDecodeError("Field " + std::to_string(fieldId), buffer, offset,
                                      "Legacy binary field exceeds buffer.");
            return false;
        }
        fieldBytes.assign(buffer.begin() + static_cast<long long>(offset),
                          buffer.begin() + static_cast<long long>(offset + logicalLength));
        offset += logicalLength;
        if (isLegacyIfbBinary(def, legacyEngine)) {
            value = toHex(fieldBytes, true);
        } else {
            value.assign(fieldBytes.begin(), fieldBytes.end());
        }
        return true;
    }
    if (def.variable) {
        if (isBinaryType(def.type)) {
            size_t len = 0;
            if (!parseAsciiLength(buffer, offset, def.lengthDigits, len, error)) {
                error = formatDecodeError("Field " + std::to_string(fieldId), buffer, fieldOffset, error);
                return false;
            }
            offset += static_cast<size_t>(def.lengthDigits);
            if (def.length > 0 && static_cast<int>(len) > def.length) {
                error = formatDecodeError("Field " + std::to_string(fieldId),
                                          buffer,
                                          fieldOffset,
                                          "Declared length exceeds maximum (declared " + std::to_string(len) +
                                              ", max " + std::to_string(def.length) + ").");
                return false;
            }
            const int hexChars = static_cast<int>(len * 2);
            if (!readHexChars(buffer, offset, hexChars, fieldBytes, error)) {
                error = formatDecodeError("Field " + std::to_string(fieldId), buffer, fieldOffset, error);
                return false;
            }
        } else {
            if (!readVariableField(buffer, offset, def.lengthDigits, def.length, fieldBytes, error)) {
                error = formatDecodeError("Field " + std::to_string(fieldId), buffer, fieldOffset, error);
                return false;
            }
        }
    } else {
        if (isBinaryType(def.type)) {
            const int hexChars = def.length * 2;
            if (!readHexChars(buffer, offset, hexChars, fieldBytes, error)) {
                error = formatDecodeError("Field " + std::to_string(fieldId), buffer, fieldOffset, error);
                return false;
            }
        } else {
            if (!readFixedField(buffer, offset, def.length, fieldBytes, error)) {
                error = formatDecodeError("Field " + std::to_string(fieldId), buffer, fieldOffset, error);
                return false;
            }
        }
    }

    if (isBinaryType(def.type)) {
        value = toHex(fieldBytes, true);
    } else {
        value.assign(fieldBytes.begin(), fieldBytes.end());
    }
    return true;
}

bool encodeFieldValue(std::vector<unsigned char>& message,
                      int fieldId,
                      const FieldDef& def,
                      const std::string& inputValue,
                      const EncodeOptions& options,
                      std::string& error) {
    std::vector<unsigned char> fieldBytes;
    std::vector<unsigned char> wireBytes;

    if (options.legacyEngine && def.sourceType == "IFA_HHHHCHAR") {
        if (inputValue.size() > static_cast<size_t>(def.length) || inputValue.size() > 0xFFFF) {
            error = formatEncodeInputError("Field " + std::to_string(fieldId) + " exceeds HHHH length.");
            return false;
        }
        char lengthText[5] = {};
        std::snprintf(lengthText, sizeof(lengthText), "%04X", static_cast<unsigned int>(inputValue.size()));
        message.insert(message.end(), lengthText, lengthText + 4);
        message.insert(message.end(), inputValue.begin(), inputValue.end());
        return true;
    }

    if (isLegacyIfb(def, options.legacyEngine)) {
        std::string textValue = inputValue;
        if (isLegacyIfbNumeric(def, options.legacyEngine)) {
            if (options.allowNumericSanitize) {
                textValue = sanitizeNumericText(textValue);
            }
            if (!validateNumericText(textValue)) {
                error = formatEncodeInputError("Field " + std::to_string(fieldId) + " expects numeric value.");
                return false;
            }
        }
        if (isLegacyIfbBinary(def, options.legacyEngine)) {
            HexParseResult hex = fromHex(inputValue);
            if (!hex.ok) {
                error = formatEncodeInputError("Field " + std::to_string(fieldId) + ": " + hex.error);
                return false;
            }
            if ((!def.variable && hex.bytes.size() != static_cast<size_t>(def.length)) ||
                (def.variable && hex.bytes.size() > static_cast<size_t>(def.length))) {
                error = formatEncodeInputError("Field " + std::to_string(fieldId) + " binary length mismatch.");
                return false;
            }
            if (def.variable && !appendPackedDecimalLength(message, hex.bytes.size(), def.lengthDigits, error)) {
                error = formatEncodeInputError("Field " + std::to_string(fieldId) + ": " + error);
                return false;
            }
            message.insert(message.end(), hex.bytes.begin(), hex.bytes.end());
            return true;
        }
        if (def.variable && textValue.size() > static_cast<size_t>(def.length)) {
            error = formatEncodeInputError("Field " + std::to_string(fieldId) + " exceeds maximum length.");
            return false;
        }
        if (def.variable && !appendPackedDecimalLength(message, textValue.size(), def.lengthDigits, error)) {
            error = formatEncodeInputError("Field " + std::to_string(fieldId) + ": " + error);
            return false;
        }
        if (isLegacyIfbNumeric(def, options.legacyEngine)) {
            if (!def.variable) {
                if (textValue.size() > static_cast<size_t>(def.length)) {
                    error = formatEncodeInputError("Field " + std::to_string(fieldId) + " exceeds fixed length.");
                    return false;
                }
                textValue.insert(textValue.begin(), static_cast<size_t>(def.length) - textValue.size(), '0');
            }
            const bool panRightPad = def.sourceType == "IFB_LLNUM_PAN_HC";
            if (!packBcd(textValue, !panRightPad, panRightPad ? 0x0F : 0x00, wireBytes, error)) {
                error = formatEncodeInputError("Field " + std::to_string(fieldId) + ": " + error);
                return false;
            }
            message.insert(message.end(), wireBytes.begin(), wireBytes.end());
            return true;
        }
        if (!def.variable && textValue.size() > static_cast<size_t>(def.length)) {
            error = formatEncodeInputError("Field " + std::to_string(fieldId) + " exceeds fixed length.");
            return false;
        }
        if (!def.variable && def.type == FieldType::CharFixed) {
            textValue.append(static_cast<size_t>(def.length) - textValue.size(), ' ');
        }
        message.insert(message.end(), textValue.begin(), textValue.end());
        return true;
    }

    if (isBinaryType(def.type)) {
        HexParseResult hex = fromHex(inputValue);
        if (!hex.ok) {
            error = formatEncodeInputError("Field " + std::to_string(fieldId) + ": " + hex.error);
            return false;
        }
        if (def.variable) {
            if (def.length > 0 && static_cast<int>(hex.bytes.size()) > def.length) {
                error = formatEncodeInputError("Field " + std::to_string(fieldId) +
                                               " exceeds max length (got " +
                                               std::to_string(hex.bytes.size()) + " bytes, max " +
                                               std::to_string(def.length) + ").");
                return false;
            }
        } else if (static_cast<int>(hex.bytes.size()) != def.length) {
            if (options.allowBinaryPadding && static_cast<int>(hex.bytes.size()) < def.length) {
                hex.bytes.resize(static_cast<size_t>(def.length), 0x00);
            } else {
                error = formatEncodeInputError("Field " + std::to_string(fieldId) +
                                               " binary length mismatch (got " +
                                               std::to_string(hex.bytes.size()) + " bytes, expected " +
                                               std::to_string(def.length) + ").");
                return false;
            }
        }
        fieldBytes.assign(hex.bytes.begin(), hex.bytes.end());
        const std::string hexText = toHex(fieldBytes, true);
        wireBytes.assign(hexText.begin(), hexText.end());
    } else {
        std::string textValue = inputValue;
        if (isNumericType(def.type)) {
            if (options.allowNumericSanitize) {
                textValue = sanitizeNumericText(textValue);
            }
            if (!validateNumericText(textValue)) {
                error = formatEncodeInputError("Field " + std::to_string(fieldId) + " expects numeric value.");
                return false;
            }
        }
        fieldBytes = toAsciiBytes(textValue);
        wireBytes = fieldBytes;
    }

    if (def.variable) {
        if (def.length > 0 && static_cast<int>(fieldBytes.size()) > def.length) {
            error = formatEncodeInputError("Field " + std::to_string(fieldId) + " exceeds max length (got " +
                                           std::to_string(fieldBytes.size()) + " bytes, max " +
                                           std::to_string(def.length) + ").");
            return false;
        }
        if (isBinaryType(def.type)) {
            if (!appendAsciiLength(message, fieldBytes.size(), def.lengthDigits, error)) {
                error = formatEncodeInputError("Field " + std::to_string(fieldId) + ": " + error);
                return false;
            }
        } else {
            if (!appendAsciiLength(message, wireBytes.size(), def.lengthDigits, error)) {
                error = formatEncodeInputError("Field " + std::to_string(fieldId) + ": " + error);
                return false;
            }
        }
        message.insert(message.end(), wireBytes.begin(), wireBytes.end());
        return true;
    }

    if (def.length <= 0) {
        error = formatPackagerError("Field " + std::to_string(fieldId) + " has invalid length.");
        return false;
    }
    if (isBinaryType(def.type)) {
        message.insert(message.end(), wireBytes.begin(), wireBytes.end());
        return true;
    }
    if (def.type == FieldType::NumericFixed || def.type == FieldType::Amount) {
        if (static_cast<int>(fieldBytes.size()) > def.length) {
            error = formatEncodeInputError("Field " + std::to_string(fieldId) + " exceeds fixed length (got " +
                                           std::to_string(fieldBytes.size()) + " bytes, expected " +
                                           std::to_string(def.length) + ").");
            return false;
        }
        fieldBytes.insert(fieldBytes.begin(), def.length - fieldBytes.size(), '0');
    } else if (def.type == FieldType::CharFixed) {
        if (static_cast<int>(fieldBytes.size()) > def.length) {
            error = formatEncodeInputError("Field " + std::to_string(fieldId) + " exceeds fixed length (got " +
                                           std::to_string(fieldBytes.size()) + " bytes, expected " +
                                           std::to_string(def.length) + ").");
            return false;
        }
        fieldBytes.insert(fieldBytes.end(), def.length - fieldBytes.size(), ' ');
    }
    message.insert(message.end(), fieldBytes.begin(), fieldBytes.end());
    return true;
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
                result.error = formatPackagerError("Length header size must be positive for auto-detect.");
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
                    result.error = formatDecodeError("Length header", data, offset, error);
                    return result;
                }
                result.headerFormat = LengthFormat::AsciiDigits;
            } else if (options.header.format == LengthFormat::BinaryBigEndian) {
                if (!parseBinaryLength(data, offset, options.header.size, messageLength, error)) {
                    result.ok = false;
                    result.error = formatDecodeError("Length header", data, offset, error);
                    return result;
                }
                result.headerFormat = LengthFormat::BinaryBigEndian;
            }
            offset += static_cast<size_t>(options.header.size);
            if (offset + messageLength > data.size()) {
                result.ok = false;
                result.error = formatDecodeError("Length header",
                                                 data,
                                                 offset - static_cast<size_t>(options.header.size),
                                                 "Declared message length " + std::to_string(messageLength) +
                                                     " exceeds available buffer.");
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

    std::string error;
    if (packager.bitmapIndex < 0) {
        for (int fieldId : sortedFieldIds(packager, false)) {
            if (offset >= buffer.size()) {
                break;
            }
            const FieldDef& def = packager.fields.at(fieldId);
            std::string value;
            if (!decodeFieldValue(buffer, offset, fieldId, def, options.legacyEngine, value, error)) {
                result.ok = false;
                result.error = error;
                return result;
            }
            result.fields[fieldId] = value;
        }
        if (offset != buffer.size()) {
            result.ok = false;
            result.error = formatDecodeError("Sequential field layout",
                                             buffer,
                                             offset,
                                             "Unread bytes remain after decoding all known fields.");
            return result;
        }
        result.ok = true;
        return result;
    }

    if (packager.bitmapIndex == 0) {
        const int bitCount = packager.fieldCount > 0 ? packager.fieldCount : 64;
        const int bitmapHexChars = ((bitCount + 7) / 8) * 2;
        std::vector<unsigned char> bitmapBytes;
        const auto bitmapDefIt = packager.fields.find(0);
        const bool binaryBitmap = options.legacyEngine && bitmapDefIt != packager.fields.end() &&
                                  bitmapDefIt->second.sourceType == "IFB_BITMAP";
        if (binaryBitmap) {
            const int bitmapBytesCount = bitmapHexChars / 2;
            if (!readFixedField(buffer, offset, bitmapBytesCount, bitmapBytes, error)) {
                result.ok = false;
                result.error = formatDecodeError("Bitmap", buffer, offset, error);
                return result;
            }
        } else if (!readHexChars(buffer, offset, bitmapHexChars, bitmapBytes, error)) {
            result.ok = false;
            result.error = formatDecodeError("Bitmap", buffer, offset, error);
            return result;
        }
        result.fields[0] = toHex(bitmapBytes, true);

        const std::vector<bool> bits = bitmapToBits(bitmapBytes);
        const int maxField = std::min(bitCount, static_cast<int>(bits.size() - 1));
        for (int fieldId = 1; fieldId <= maxField; ++fieldId) {
            if (!bits[fieldId]) {
                continue;
            }
            auto defIt = packager.fields.find(fieldId);
            if (defIt == packager.fields.end()) {
                result.ok = false;
                result.error = formatPackagerError("Missing definition for field " + std::to_string(fieldId) + ".");
                return result;
            }

            std::string value;
            if (!decodeFieldValue(buffer, offset, fieldId, defIt->second, options.legacyEngine, value, error)) {
                result.ok = false;
                result.error = error;
                return result;
            }
            result.fields[fieldId] = value;
        }
        result.ok = true;
        return result;
    }

    auto mtiIt = packager.fields.find(0);
    if (mtiIt == packager.fields.end()) {
        result.ok = false;
        result.error = formatPackagerError("Missing field 0 (MTI) definition.");
        return result;
    }
    std::string mtiValue;
    if (!decodeFieldValue(buffer, offset, 0, mtiIt->second, options.legacyEngine, mtiValue, error)) {
        result.ok = false;
        result.error = error;
        return result;
    }
    result.fields[0] = mtiValue;

    std::vector<unsigned char> bitmapBytes;
    bool hasSecondary = false;
    const auto bitmapDefIt = packager.fields.find(packager.bitmapIndex);
    const bool binaryBitmap = options.legacyEngine && bitmapDefIt != packager.fields.end() &&
                              bitmapDefIt->second.sourceType == "IFB_BITMAP";
    if ((binaryBitmap && !readFixedField(buffer, offset, 8, bitmapBytes, error)) ||
        (!binaryBitmap && !readHexChars(buffer, offset, 16, bitmapBytes, error))) {
        result.ok = false;
        result.error = formatDecodeError("Bitmap", buffer, offset, error);
        return result;
    }
    hasSecondary = (bitmapBytes[0] & 0x80) != 0;
    if (hasSecondary) {
        std::vector<unsigned char> secondaryBytes;
        if ((binaryBitmap && !readFixedField(buffer, offset, 8, secondaryBytes, error)) ||
            (!binaryBitmap && !readHexChars(buffer, offset, 16, secondaryBytes, error))) {
            result.ok = false;
            result.error = formatDecodeError("Secondary bitmap", buffer, offset, error);
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
            result.error = formatPackagerError("Missing definition for field " + std::to_string(fieldId) + ".");
            return result;
        }

        std::string value;
        if (!decodeFieldValue(buffer, offset, fieldId, defIt->second, options.legacyEngine, value, error)) {
            result.ok = false;
            result.error = error;
            return result;
        }
        result.fields[fieldId] = value;
    }

    result.ok = true;
    return result;
}

EncodeResult Iso8583Codec::encode(const std::map<int, std::string>& fields,
                                  const Packager& packager,
                                  const EncodeOptions& options) {
    EncodeResult result;
    std::string error;

    std::vector<unsigned char> message;
    if (packager.bitmapIndex < 0) {
        const std::vector<int> ids = sortedFieldIds(packager, false);
        int lastPresentIndex = -1;
        for (int i = 0; i < static_cast<int>(ids.size()); ++i) {
            if (fields.find(ids[static_cast<size_t>(i)]) != fields.end()) {
                lastPresentIndex = i;
            }
        }
        for (int i = 0; i <= lastPresentIndex; ++i) {
            const int fieldId = ids[static_cast<size_t>(i)];
            const auto valueIt = fields.find(fieldId);
            if (valueIt == fields.end()) {
                result.ok = false;
                result.error = formatEncodeInputError("Sequential field layout requires field " +
                                                      std::to_string(fieldId) + ".");
                return result;
            }
            const FieldDef& def = packager.fields.at(fieldId);
            if (!encodeFieldValue(message, fieldId, def, valueIt->second, options, error)) {
                result.ok = false;
                result.error = error;
                return result;
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

    if (packager.bitmapIndex == 0) {
        bool hasSecondary = false;
        const std::vector<unsigned char> bitmap = buildBitmapForPackager(fields, packager, hasSecondary);
        const auto bitmapDefIt = packager.fields.find(0);
        const bool binaryBitmap = options.legacyEngine && bitmapDefIt != packager.fields.end() &&
                                  bitmapDefIt->second.sourceType == "IFB_BITMAP";
        if (binaryBitmap) {
            message.insert(message.end(), bitmap.begin(), bitmap.end());
        } else {
            const std::string bitmapHex = toHex(bitmap, true);
            message.insert(message.end(), bitmapHex.begin(), bitmapHex.end());
        }

        const int maxField = packager.fieldCount > 0 ? packager.fieldCount : 64;
        for (int fieldId = 1; fieldId <= maxField; ++fieldId) {
            auto valueIt = fields.find(fieldId);
            if (valueIt == fields.end()) {
                continue;
            }
            auto defIt = packager.fields.find(fieldId);
            if (defIt == packager.fields.end()) {
                result.ok = false;
                result.error = formatPackagerError("Missing definition for field " + std::to_string(fieldId) + ".");
                return result;
            }
            if (!encodeFieldValue(message, fieldId, defIt->second, valueIt->second, options, error)) {
                result.ok = false;
                result.error = error;
                return result;
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

    auto mtiIt = fields.find(0);
    if (mtiIt == fields.end()) {
        result.ok = false;
        result.error = formatEncodeInputError("Field 0 (MTI) is required.");
        return result;
    }

    auto mtiDefIt = packager.fields.find(0);
    if (mtiDefIt == packager.fields.end()) {
        result.ok = false;
        result.error = formatPackagerError("Missing field 0 (MTI) definition.");
        return result;
    }
    if (!encodeFieldValue(message, 0, mtiDefIt->second, mtiIt->second, options, error)) {
        result.ok = false;
        result.error = error;
        return result;
    }

    bool hasSecondary = false;
    std::vector<unsigned char> bitmap = buildBitmapForPackager(fields, packager, hasSecondary);
    const auto bitmapDefIt = packager.fields.find(packager.bitmapIndex);
    const bool binaryBitmap = options.legacyEngine && bitmapDefIt != packager.fields.end() &&
                              bitmapDefIt->second.sourceType == "IFB_BITMAP";
    if (binaryBitmap) {
        message.insert(message.end(), bitmap.begin(), bitmap.end());
    } else {
        std::string bitmapHex = toHex(bitmap, true);
        message.insert(message.end(), bitmapHex.begin(), bitmapHex.end());
    }

    const int maxField = packager.fieldCount > 0 ? packager.fieldCount : 128;
    for (int fieldId = 2; fieldId <= maxField; ++fieldId) {
        auto valueIt = fields.find(fieldId);
        if (valueIt == fields.end()) {
            continue;
        }
        auto defIt = packager.fields.find(fieldId);
        if (defIt == packager.fields.end()) {
            result.ok = false;
            result.error = formatPackagerError("Missing definition for field " + std::to_string(fieldId) + ".");
            return result;
        }
        if (!encodeFieldValue(message, fieldId, defIt->second, valueIt->second, options, error)) {
            result.ok = false;
            result.error = error;
            return result;
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
