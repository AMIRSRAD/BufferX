#include "PackagerLoader.h"

#include <QByteArray>
#include <QXmlStreamAttributes>
#include <QXmlStreamReader>

namespace {
std::string toStdString(QStringView value) {
    const QByteArray utf8 = value.toUtf8();
    return std::string(utf8.constData(), static_cast<size_t>(utf8.size()));
}

std::string contextPrefix(const std::string& context) {
    if (context.empty()) {
        return {};
    }
    return context + ": ";
}

bool readIntAttribute(const QXmlStreamAttributes& attrs,
                      const char* key,
                      int fallback,
                      int& out,
                      std::string& error,
                      const std::string& context) {
    const QStringView rawValue = attrs.value(QLatin1StringView(key));
    if (rawValue.isNull()) {
        out = fallback;
        return true;
    }

    bool ok = false;
    const int value = rawValue.trimmed().toInt(&ok);
    if (!ok) {
        error = contextPrefix(context) + "invalid integer value for attribute '" + key + "'.";
        return false;
    }
    out = value;
    return true;
}

bool readRequiredIntAttribute(const QXmlStreamAttributes& attrs,
                              const char* key,
                              int& out,
                              std::string& error,
                              const std::string& context) {
    const QStringView rawValue = attrs.value(QLatin1StringView(key));
    if (rawValue.isNull() || rawValue.trimmed().isEmpty()) {
        error = contextPrefix(context) + "missing required attribute '" + key + "'.";
        return false;
    }
    return readIntAttribute(attrs, key, 0, out, error, context);
}

std::string readStringAttribute(const QXmlStreamAttributes& attrs, const char* key) {
    return toStdString(attrs.value(QLatin1StringView(key)).trimmed());
}

bool readRequiredStringAttribute(const QXmlStreamAttributes& attrs,
                                 const char* key,
                                 std::string& out,
                                 std::string& error,
                                 const std::string& context) {
    const QStringView value = attrs.value(QLatin1StringView(key)).trimmed();
    if (value.isNull() || value.isEmpty()) {
        error = contextPrefix(context) + "missing required attribute '" + key + "'.";
        return false;
    }
    out = toStdString(value);
    return true;
}

} // namespace

PackagerLoadResult PackagerLoader::loadFromXml(const std::string& xml) {
    PackagerLoadResult result;
    QXmlStreamReader reader(QByteArray::fromStdString(xml));

    while (!reader.atEnd()) {
        const auto token = reader.readNext();
        if (token != QXmlStreamReader::StartElement) {
            continue;
        }

        if (reader.name() != QLatin1StringView("Packager")) {
            continue;
        }

        Packager pack;
        std::string error;
        const QXmlStreamAttributes packagerAttrs = reader.attributes();
        if (!readRequiredStringAttribute(packagerAttrs, "Name", pack.name, error, "Packager")) {
            result.error = error;
            return result;
        }
        pack.macMethod = readStringAttribute(packagerAttrs, "MacMethod");
        pack.lenFormat = readStringAttribute(packagerAttrs, "LenFormat");
        if (!readIntAttribute(packagerAttrs, "MacSize", 0, pack.macSize, error, "Packager '" + pack.name + "'") ||
            !readIntAttribute(packagerAttrs, "BitmapIndex", 1, pack.bitmapIndex, error, "Packager '" + pack.name + "'") ||
            !readIntAttribute(packagerAttrs, "SecondPartBitmap", 64, pack.secondPartBitmap, error, "Packager '" + pack.name + "'") ||
            !readIntAttribute(packagerAttrs, "FieldCount", 64, pack.fieldCount, error, "Packager '" + pack.name + "'") ||
            !readIntAttribute(packagerAttrs, "LenLen", 0, pack.lenLen, error, "Packager '" + pack.name + "'")) {
            result.error = error;
            return result;
        }

        while (!(reader.tokenType() == QXmlStreamReader::EndElement &&
                 reader.name() == QLatin1StringView("Packager")) &&
               !reader.atEnd()) {
            const auto innerToken = reader.readNext();
            if (innerToken != QXmlStreamReader::StartElement) {
                continue;
            }
            if (reader.name() != QLatin1StringView("Field")) {
                reader.skipCurrentElement();
                continue;
            }

            const QXmlStreamAttributes fieldAttrs = reader.attributes();
            FieldDef def;
            if (!readRequiredIntAttribute(fieldAttrs,
                                          "FieldId",
                                          def.id,
                                          error,
                                          "Packager '" + pack.name + "' field") ||
                !readIntAttribute(fieldAttrs,
                                  "FieldLength",
                                  0,
                                  def.length,
                                  error,
                                  "Packager '" + pack.name + "' field " + std::to_string(def.id))) {
                result.error = error;
                return result;
            }

            def.type = parseFieldType(readStringAttribute(fieldAttrs, "FieldType"));
            def.desc = readStringAttribute(fieldAttrs, "FieldDesc");
            def.flags = readStringAttribute(fieldAttrs, "Flags");
            def.lengthDigits = lengthDigitsForFieldType(def.type);
            def.variable = isVariableLength(def.type);
            pack.fields[def.id] = def;
        }

        result.packagers.push_back(std::move(pack));
    }

    if (reader.hasError()) {
        result.ok = false;
        result.error = "XML parse error at line " + std::to_string(reader.lineNumber()) + ", column " +
                       std::to_string(reader.columnNumber()) + ": " + toStdString(reader.errorString());
        return result;
    }

    if (result.packagers.empty()) {
        result.ok = false;
        result.error = "No packagers found in XML.";
        return result;
    }

    result.ok = true;
    return result;
}
