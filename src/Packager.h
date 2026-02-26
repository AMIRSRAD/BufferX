#pragma once

#include <string>
#include <unordered_map>

enum class FieldType {
    NumericFixed,
    CharFixed,
    Amount,
    BinaryFixed,
    BinaryLl,
    BinaryLll,
    Bitmap,
    LlNum,
    LllNum,
    LlChar,
    LllChar,
    Unknown
};

struct FieldDef {
    int id = 0;
    FieldType type = FieldType::Unknown;
    int length = 0;
    std::string desc;
    std::string flags;
    int lengthDigits = 0;
    bool variable = false;
};

struct Packager {
    std::string name;
    std::string macMethod;
    int macSize = 0;
    int bitmapIndex = 1;
    int secondPartBitmap = 64;
    int fieldCount = 64;
    std::string lenFormat;
    int lenLen = 0;
    std::unordered_map<int, FieldDef> fields;
};

FieldType parseFieldType(const std::string& typeName);
std::string fieldTypeToString(FieldType type);
int lengthDigitsForFieldType(FieldType type);
bool isVariableLength(FieldType type);
