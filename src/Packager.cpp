#include "Packager.h"

#include <algorithm>
#include <cctype>

namespace {
std::string toUpperAscii(const std::string& input) {
    std::string out;
    out.reserve(input.size());
    for (unsigned char ch : input) {
        out.push_back(static_cast<char>(std::toupper(ch)));
    }
    return out;
}
} // namespace

FieldType parseFieldType(const std::string& typeName) {
    const std::string type = toUpperAscii(typeName);
    if (type == "IFA_NUMERIC") {
        return FieldType::NumericFixed;
    }
    if (type == "IFB_NUMERIC") {
        return FieldType::NumericFixed;
    }
    if (type == "IF_CHAR" || type == "IFA_CHAR") {
        return FieldType::CharFixed;
    }
    if (type == "IFB_LLCHAR") {
        return FieldType::LlChar;
    }
    if (type == "IFB_LLLCHAR") {
        return FieldType::LllChar;
    }
    if (type == "IFA_AMOUNT") {
        return FieldType::Amount;
    }
    if (type == "IFA_BINARY" || type == "IFB_BINARY") {
        return FieldType::BinaryFixed;
    }
    if (type == "IFA_LLBINARY" || type == "IFB_LLBINARY") {
        return FieldType::BinaryLl;
    }
    if (type == "IFA_LLLBINARY" || type == "IFB_LLLBINARY") {
        return FieldType::BinaryLll;
    }
    if (type == "IFA_LLLLBINARY" || type == "IFB_LLLLBINARY") {
        return FieldType::BinaryLlll;
    }
    if (type == "IFA_BITMAP") {
        return FieldType::Bitmap;
    }
    if (type == "IFB_BITMAP") {
        return FieldType::Bitmap;
    }
    if (type == "IFA_LLNUM") {
        return FieldType::LlNum;
    }
    if (type == "IFA_LLLNUM") {
        return FieldType::LllNum;
    }
    if (type == "IFB_LLNUM_BCD" || type == "IFB_LLNUM_PAN_HC") {
        return FieldType::LlNum;
    }
    if (type == "IFA_LLCHAR") {
        return FieldType::LlChar;
    }
    if (type == "IFA_LLLCHAR") {
        return FieldType::LllChar;
    }
    if (type == "IFA_LLLLCHAR" || type == "IFA_HHHHCHAR") {
        return FieldType::LlllChar;
    }
    if (type == "IFA_LLLLLCHAR") {
        return FieldType::LllllChar;
    }
    if (type == "IFA_LLLLLLCHAR") {
        return FieldType::LlllllChar;
    }
    if (type == "IFA_L7CHAR") {
        return FieldType::L7Char;
    }
    return FieldType::Unknown;
}

std::string fieldTypeToString(FieldType type) {
    switch (type) {
        case FieldType::NumericFixed:
            return "Numeric";
        case FieldType::CharFixed:
            return "Char";
        case FieldType::Amount:
            return "Amount";
        case FieldType::BinaryFixed:
        case FieldType::BinaryLl:
        case FieldType::BinaryLll:
        case FieldType::BinaryLlll:
            return "Binary";
        case FieldType::Bitmap:
            return "Bitmap";
        case FieldType::LlNum:
            return "LLNUM";
        case FieldType::LllNum:
            return "LLLNUM";
        case FieldType::LlChar:
            return "LLCHAR";
        case FieldType::LllChar:
            return "LLLCHAR";
        case FieldType::LlllChar:
            return "LLLLCHAR";
        case FieldType::LllllChar:
            return "LLLLLCHAR";
        case FieldType::LlllllChar:
            return "LLLLLLCHAR";
        case FieldType::L7Char:
            return "L7CHAR";
        case FieldType::Unknown:
        default:
            return "Unknown";
    }
}

int lengthDigitsForFieldType(FieldType type) {
    switch (type) {
        case FieldType::LlNum:
        case FieldType::LlChar:
        case FieldType::BinaryLl:
            return 2;
        case FieldType::LllNum:
        case FieldType::LllChar:
        case FieldType::BinaryLll:
            return 3;
        case FieldType::LlllChar:
        case FieldType::BinaryLlll:
            return 4;
        case FieldType::LllllChar:
            return 5;
        case FieldType::LlllllChar:
            return 6;
        case FieldType::L7Char:
            return 7;
        default:
            return 0;
    }
}

bool isVariableLength(FieldType type) {
    return lengthDigitsForFieldType(type) > 0;
}
