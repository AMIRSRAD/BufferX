#pragma once

#include <QString>

#include <vector>

namespace iransystem {

struct ConversionResult {
    bool ok = false;
    QString error;
    QString text;
    std::vector<unsigned char> bytes;
};

ConversionResult toUnicode(const std::vector<unsigned char>& bytes);
ConversionResult fromUnicode(const QString& text, bool convertNumbers);
ConversionResult toUnicodeFromText(const QString& iranSystemText);
ConversionResult fromUnicodeToText(const QString& text, bool convertNumbers);

} // namespace iransystem
