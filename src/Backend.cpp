#include "Backend.h"

#include "Crypto.h"
#include "Hex.h"
#include "IranSystem.h"
#include "Mac.h"
#include "PackagerLoader.h"
#include "Tlv.h"

#include <QFile>
#include <QFileDialog>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

#include <algorithm>
#include <map>

#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#endif

namespace {

bool isMacFieldDescriptor(const FieldDef& def) {
    const auto hasToken = [&](const char* token) {
        const QString desc = QString::fromStdString(def.desc).toUpper();
        return desc.contains(QString::fromLatin1(token));
    };
    return def.id == 64 || def.id == 96 || def.id == 128 || hasToken("AUTHENTICATION CODE") || hasToken("MAC");
}

bool parseFieldsArray(const QString& fieldsJson,
                     std::map<int, std::string>& fields,
                     QString& error) {
    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(fieldsJson.toUtf8(), &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isArray()) {
        error = QStringLiteral("Invalid fields JSON.");
        return false;
    }

    const QJsonArray array = document.array();
    for (const QJsonValue& value : array) {
        if (!value.isObject()) {
            continue;
        }
        const QJsonObject obj = value.toObject();
        const int id = obj.value("id").toInt(-1);
        if (id < 0) {
            continue;
        }
        const QString fieldValue = obj.value("value").toString();
        if (fieldValue.isEmpty() && id != 0) {
            continue;
        }
        const QByteArray utf8 = fieldValue.toUtf8();
        fields[id] = std::string(utf8.constData(), static_cast<size_t>(utf8.size()));
    }

    return true;
}

MacPaddingMode parseMacPaddingMode(const QString& mode) {
    const QString lowered = mode.trimmed().toLower();
    if (lowered == "m2" || lowered == "iso9797-2" || lowered == "iso9797method2") {
        return MacPaddingMode::Iso9797Method2;
    }
    return MacPaddingMode::Iso9797Method1;
}

int macOutputBytesForField(const Packager& packager, int macFieldId) {
    const auto defIt = packager.fields.find(macFieldId);
    if (defIt != packager.fields.end() && defIt->second.length > 0) {
        return defIt->second.length;
    }
    if (packager.macSize > 0 && (packager.macSize % 2) == 0) {
        return packager.macSize / 2;
    }
    return 8;
}

bool parsePayloadBytes(const QString& payload, bool inputHex, std::vector<unsigned char>& bytes, QString& error) {
    if (inputHex) {
        const HexParseResult parsed = fromHex(payload.toStdString());
        if (!parsed.ok) {
            error = QString::fromStdString(parsed.error);
            return false;
        }
        bytes = parsed.bytes;
        return true;
    }

    const QByteArray utf8 = payload.toUtf8();
    bytes.assign(utf8.begin(), utf8.end());
    return true;
}

QJsonObject tlvNodeToJson(const tlvtool::Node& node, const QString& prefix) {
    const QString tagHex = QString::fromStdString(tlvtool::toHex(node.tag, '/'));
    const QString path = prefix.isEmpty() ? tagHex : (prefix + QLatin1Char('/') + tagHex);
    QJsonObject obj;
    obj["tagHex"] = QString::fromStdString(tlvtool::toHex(node.tag, ' '));
    obj["path"] = path;
    size_t payloadLength = node.value.size();
    if (node.isComposite()) {
        payloadLength = 0;
        for (const auto& child : node.children) {
            payloadLength += child.encode().size();
        }
    }
    obj["length"] = static_cast<int>(payloadLength);
    obj["composite"] = node.isComposite();
    if (node.isComposite()) {
        QJsonArray children;
        for (const auto& child : node.children) {
            children.append(tlvNodeToJson(child, path));
        }
        obj["children"] = children;
    } else {
        obj["valueHex"] = QString::fromStdString(tlvtool::toHex(node.value, ' '));
        obj["valueText"] = QString::fromStdString(tlvtool::toAsciiDebug(node.value));
        obj["description"] = QString::fromStdString(tlvtool::describePath(path.toStdString()));
    }
    return obj;
}

#ifdef _WIN32
QString ansiBytesToUtf8Text(const QByteArray& ansi, QString& error) {
    if (ansi.isEmpty()) {
        return QString();
    }

    const int wideLength = MultiByteToWideChar(CP_ACP, 0, ansi.constData(), ansi.size(), nullptr, 0);
    if (wideLength <= 0) {
        error = QStringLiteral("Failed to decode ANSI text.");
        return QString();
    }

    std::wstring wide(static_cast<size_t>(wideLength), L'\0');
    const int converted = MultiByteToWideChar(CP_ACP, 0, ansi.constData(), ansi.size(), wide.data(), wideLength);
    if (converted != wideLength) {
        error = QStringLiteral("Failed to decode ANSI text.");
        return QString();
    }

    QString text = QString::fromWCharArray(wide.data(), wideLength);
    text.replace(QChar(0x064A), QChar(0x06CC));
    text.replace(QChar(0x0649), QChar(0x06CC));
    text.replace(QChar(0x0643), QChar(0x06A9));
    return text;
}

QByteArray utf8TextToAnsiBytes(const QString& text, QString& error) {
    if (text.isEmpty()) {
        return {};
    }

    const std::wstring wide = text.toStdWString();
    const int ansiLength = WideCharToMultiByte(CP_ACP, 0, wide.c_str(), static_cast<int>(wide.size()), nullptr, 0, nullptr, nullptr);
    if (ansiLength <= 0) {
        error = QStringLiteral("Failed to encode text as ANSI.");
        return {};
    }

    std::string ansi(static_cast<size_t>(ansiLength), '\0');
    const int converted = WideCharToMultiByte(CP_ACP,
                                              0,
                                              wide.c_str(),
                                              static_cast<int>(wide.size()),
                                              ansi.data(),
                                              ansiLength,
                                              nullptr,
                                              nullptr);
    if (converted != ansiLength) {
        error = QStringLiteral("Failed to encode text as ANSI.");
        return {};
    }
    return QByteArray(ansi.data(), ansiLength);
}
#endif

} // namespace

Backend::Backend(QObject* parent) : QObject(parent) {}

QString Backend::defaultPackagerPath() const {
    return QStringLiteral(":/data/packagers.xml");
}

QString Backend::jsonError(const QString& message) {
    QJsonObject obj;
    obj["ok"] = false;
    obj["error"] = message;
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

Packager* Backend::findPackager(const QString& name) {
    for (auto& packager : packagers_) {
        if (QString::fromStdString(packager.name) == name) {
            return &packager;
        }
    }
    return nullptr;
}

const Packager* Backend::findPackager(const QString& name) const {
    for (const auto& packager : packagers_) {
        if (QString::fromStdString(packager.name) == name) {
            return &packager;
        }
    }
    return nullptr;
}

LengthFormat Backend::parseLengthFormat(const QString& mode) {
    const QString lowered = mode.trimmed().toLower();
    if (lowered == "ascii") {
        return LengthFormat::AsciiDigits;
    }
    if (lowered == "binary") {
        return LengthFormat::BinaryBigEndian;
    }
    return LengthFormat::None;
}

QString Backend::loadPackagerFile(const QString& path) {
    const QString resolvedPath = path.trimmed().isEmpty() ? defaultPackagerPath() : path;
    QFile file(resolvedPath);
    if (!file.open(QIODevice::ReadOnly)) {
        return jsonError(QStringLiteral("Failed to open packager file: %1").arg(resolvedPath));
    }

    const QByteArray xmlData = file.readAll();
    const PackagerLoadResult loadResult = PackagerLoader::loadFromXml(xmlData.toStdString());
    if (!loadResult.ok) {
        return jsonError(QString::fromStdString(loadResult.error));
    }

    packagers_ = loadResult.packagers;
    QJsonArray names;
    for (const auto& packager : packagers_) {
        names.append(QString::fromStdString(packager.name));
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["packagers"] = names;
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::packagerFieldsJson(const QString& packagerName) const {
    const Packager* packager = findPackager(packagerName);
    if (!packager) {
        return jsonError(QStringLiteral("Packager not found: %1").arg(packagerName));
    }

    std::vector<int> ids;
    ids.reserve(packager->fields.size());
    for (const auto& entry : packager->fields) {
        ids.push_back(entry.first);
    }
    std::sort(ids.begin(), ids.end());

    QJsonArray fields;
    QJsonArray macFieldIds;
    for (int id : ids) {
        const FieldDef& def = packager->fields.at(id);
        QJsonObject fieldObj;
        fieldObj["id"] = def.id;
        fieldObj["desc"] = QString::fromStdString(def.desc);
        fieldObj["type"] = QString::fromStdString(fieldTypeToString(def.type));
        fieldObj["length"] = def.length;
        fieldObj["variable"] = def.variable;
        fieldObj["lengthDigits"] = def.lengthDigits;
        fields.append(fieldObj);
        if (packager->macSize > 0 && isMacFieldDescriptor(def)) {
            macFieldIds.append(def.id);
        }
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["name"] = QString::fromStdString(packager->name);
    obj["lenLen"] = packager->lenLen;
    obj["lenFormat"] = QString::fromStdString(packager->lenFormat);
    obj["fieldCount"] = packager->fieldCount;
    obj["macMethod"] = QString::fromStdString(packager->macMethod);
    obj["macSize"] = packager->macSize;
    obj["macConfigured"] = packager->macSize > 0;
    obj["macSupported"] = packager->macSize > 0;
    obj["macAutoEncodeSupported"] = false;
    obj["macFieldIds"] = macFieldIds;
    obj["fields"] = fields;
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::choosePackagerFile() const {
    return QFileDialog::getOpenFileName(nullptr,
                                        QStringLiteral("Select packager XML"),
                                        QString(),
                                        QStringLiteral("Packager XML (*.xml);;All files (*)"));
}

QString Backend::chooseBufferOpenFile() const {
    return QFileDialog::getOpenFileName(nullptr,
                                        QStringLiteral("Import buffer"),
                                        QString(),
                                        QStringLiteral("Buffer JSON (*.json);;All files (*)"));
}

QString Backend::chooseBufferSaveFile() const {
    return QFileDialog::getSaveFileName(nullptr,
                                        QStringLiteral("Save buffer"),
                                        QString(),
                                        QStringLiteral("Buffer JSON (*.json);;All files (*)"));
}

QString Backend::utf8ToHex(const QString& text) const {
    const QByteArray utf8 = text.toUtf8();
    std::vector<unsigned char> bytes;
    bytes.reserve(static_cast<size_t>(utf8.size()));
    for (unsigned char ch : utf8) {
        bytes.push_back(ch);
    }
    return QString::fromStdString(toHex(bytes, true));
}

QString Backend::hexToUtf8(const QString& hexText) const {
    HexParseResult parsed = fromHex(hexText.toStdString());
    if (!parsed.ok) {
        QJsonObject obj;
        obj["ok"] = false;
        obj["error"] = QString::fromStdString(parsed.error);
        return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
    }
    const QByteArray utf8(reinterpret_cast<const char*>(parsed.bytes.data()),
                          static_cast<int>(parsed.bytes.size()));
    QJsonObject obj;
    obj["ok"] = true;
    obj["text"] = QString::fromUtf8(utf8);
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::iranSystemToUnicode(const QString& payload, bool inputHex) const {
    std::vector<unsigned char> bytes;
    QString error;
    if (!parsePayloadBytes(payload, inputHex, bytes, error)) {
        return jsonError(error);
    }

    const iransystem::ConversionResult converted = iransystem::toUnicode(bytes);
    if (!converted.ok) {
        return jsonError(converted.error);
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["text"] = converted.text;
    obj["rawHex"] = QString::fromStdString(toHex(bytes, true));
    obj["length"] = static_cast<int>(bytes.size());
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::unicodeToIranSystem(const QString& text, bool convertNumbers) const {
    const iransystem::ConversionResult converted = iransystem::fromUnicode(text, convertNumbers);
    if (!converted.ok) {
        return jsonError(converted.error);
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["text"] = text;
    obj["rawHex"] = QString::fromStdString(toHex(converted.bytes, true));
    obj["length"] = static_cast<int>(converted.bytes.size());
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::iranSystemTextToUtf8(const QString& text) const {
    const iransystem::ConversionResult converted = iransystem::toUnicodeFromText(text);
    if (!converted.ok) {
        return jsonError(converted.error);
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["text"] = converted.text;
    obj["length"] = static_cast<int>(converted.bytes.size());
    obj["rawHex"] = QString::fromStdString(toHex(converted.bytes, true));
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::utf8ToIranSystemText(const QString& text, bool convertNumbers) const {
    const iransystem::ConversionResult converted = iransystem::fromUnicodeToText(text, convertNumbers);
    if (!converted.ok) {
        return jsonError(converted.error);
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["text"] = converted.text;
    obj["length"] = static_cast<int>(converted.bytes.size());
    obj["rawHex"] = QString::fromStdString(toHex(converted.bytes, true));
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::asciiToUtf8Text(const QString& text) const {
    for (QChar ch : text) {
        if (ch.unicode() > 0x7F) {
            return jsonError(QStringLiteral("Input contains non-ASCII characters."));
        }
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["text"] = text;
    obj["length"] = text.size();
    obj["rawHex"] = utf8ToHex(text);
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::utf8ToAsciiText(const QString& text) const {
    QByteArray ascii;
    ascii.reserve(text.size());
    for (QChar ch : text) {
        if (ch.unicode() > 0x7F) {
            return jsonError(QStringLiteral("Text contains characters that cannot be represented in ASCII."));
        }
        ascii.push_back(static_cast<char>(ch.unicode()));
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["text"] = QString::fromLatin1(ascii);
    obj["length"] = ascii.size();
    obj["rawHex"] = QString::fromStdString(toHex(std::vector<unsigned char>(ascii.begin(), ascii.end()), true));
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::ansiToUtf8Text(const QString& text) const {
#ifdef _WIN32
    QString error;
    const QByteArray ansi = utf8TextToAnsiBytes(text, error);
    if (!error.isEmpty()) {
        return jsonError(error);
    }
    const QString utf8 = ansiBytesToUtf8Text(ansi, error);
    if (!error.isEmpty()) {
        return jsonError(error);
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["text"] = utf8;
    obj["length"] = ansi.size();
    obj["rawHex"] = QString::fromStdString(toHex(std::vector<unsigned char>(ansi.begin(), ansi.end()), true));
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
#else
    return jsonError(QStringLiteral("ANSI conversion is only available on Windows builds."));
#endif
}

QString Backend::utf8ToAnsiText(const QString& text) const {
#ifdef _WIN32
    QString error;
    const QByteArray ansi = utf8TextToAnsiBytes(text, error);
    if (!error.isEmpty()) {
        return jsonError(error);
    }
    const QString ansiDisplay = ansiBytesToUtf8Text(ansi, error);
    if (!error.isEmpty()) {
        return jsonError(error);
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["text"] = ansiDisplay;
    obj["length"] = ansi.size();
    obj["rawHex"] = QString::fromStdString(toHex(std::vector<unsigned char>(ansi.begin(), ansi.end()), true));
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
#else
    return jsonError(QStringLiteral("ANSI conversion is only available on Windows builds."));
#endif
}

QString Backend::ansiHexToUtf8Text(const QString& hexText) const {
#ifdef _WIN32
    const HexParseResult parsed = fromHex(hexText.toStdString());
    if (!parsed.ok) {
        return jsonError(QString::fromStdString(parsed.error));
    }

    QString error;
    const QByteArray ansi(reinterpret_cast<const char*>(parsed.bytes.data()), static_cast<int>(parsed.bytes.size()));
    const QString utf8 = ansiBytesToUtf8Text(ansi, error);
    if (!error.isEmpty()) {
        return jsonError(error);
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["text"] = utf8;
    obj["length"] = ansi.size();
    obj["rawHex"] = QString::fromStdString(toHex(parsed.bytes, true));
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
#else
    return jsonError(QStringLiteral("ANSI conversion is only available on Windows builds."));
#endif
}

QString Backend::utf8ToAnsiHex(const QString& text) const {
#ifdef _WIN32
    QString error;
    const QByteArray ansi = utf8TextToAnsiBytes(text, error);
    if (!error.isEmpty()) {
        return jsonError(error);
    }

    const std::vector<unsigned char> bytes(ansi.begin(), ansi.end());
    const QString hex = QString::fromStdString(toHex(bytes, true));
    QJsonObject obj;
    obj["ok"] = true;
    obj["text"] = hex;
    obj["length"] = ansi.size();
    obj["rawHex"] = hex;
    obj["preview"] = text;
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
#else
    return jsonError(QStringLiteral("ANSI conversion is only available on Windows builds."));
#endif
}

QString Backend::decodeBuffer(const QString& packagerName,
                              const QString& payload,
                              bool inputHex,
                              bool lengthHeaderEnabled,
                              const QString& lengthMode,
                              int lengthSize) {
    const Packager* packager = findPackager(packagerName);
    if (!packager) {
        return jsonError(QStringLiteral("Packager not found: %1").arg(packagerName));
    }

    std::vector<unsigned char> bytes;
    if (inputHex) {
        HexParseResult hex = fromHex(payload.toStdString());
        if (!hex.ok) {
            return jsonError(QString::fromStdString(hex.error));
        }
        bytes.assign(hex.bytes.begin(), hex.bytes.end());
    } else {
        const QByteArray data = payload.toUtf8();
        bytes.assign(data.begin(), data.end());
    }

    DecodeOptions options;
    options.header.enabled = lengthHeaderEnabled;
    options.header.format = parseLengthFormat(lengthMode);
    options.header.size = lengthSize;
    const bool autoDetect = lengthMode.trimmed().toLower() == "auto";
    options.autoDetectHeader = autoDetect;
    if (lengthHeaderEnabled && !autoDetect && options.header.format == LengthFormat::None) {
        return jsonError(QStringLiteral("Length header mode must be ascii or binary."));
    }
    if (lengthHeaderEnabled && autoDetect && lengthSize <= 0) {
        return jsonError(QStringLiteral("Auto-detect requires a positive length size."));
    }

    DecodeResult decoded = Iso8583Codec::decode(bytes, *packager, options);
    if (!decoded.ok) {
        return jsonError(QString::fromStdString(decoded.error));
    }

    QJsonArray fields;
    for (const auto& entry : decoded.fields) {
        const int id = entry.first;
        const std::string& value = entry.second;
        QJsonObject fieldObj;
        fieldObj["id"] = id;
        fieldObj["value"] = QString::fromUtf8(value.data(), static_cast<int>(value.size()));
        auto defIt = packager->fields.find(id);
        if (defIt != packager->fields.end()) {
            fieldObj["desc"] = QString::fromStdString(defIt->second.desc);
            fieldObj["type"] = QString::fromStdString(fieldTypeToString(defIt->second.type));
        }
        fields.append(fieldObj);
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["fields"] = fields;
    obj["rawHex"] = QString::fromStdString(toHex(bytes, true));

    obj["headerDetected"] = decoded.headerDetected;
    obj["headerSize"] = decoded.headerSize;
    obj["messageLength"] = static_cast<int>(decoded.messageLength);
    if (decoded.headerFormat == LengthFormat::AsciiDigits) {
        obj["headerMode"] = QStringLiteral("ascii");
    } else if (decoded.headerFormat == LengthFormat::BinaryBigEndian) {
        obj["headerMode"] = QStringLiteral("binary");
    } else {
        obj["headerMode"] = QStringLiteral("none");
    }
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::encodeBuffer(const QString& packagerName,
                              const QString& fieldsJson,
                              bool outputHex,
                              bool allowBinaryPadding,
                              bool allowNumericSanitize,
                              bool lengthHeaderEnabled,
                              const QString& lengthMode,
                              int lengthSize) {
    const Packager* packager = findPackager(packagerName);
    if (!packager) {
        return jsonError(QStringLiteral("Packager not found: %1").arg(packagerName));
    }

    std::map<int, std::string> fields;
    QString parseError;
    if (!parseFieldsArray(fieldsJson, fields, parseError)) {
        return jsonError(parseError);
    }

    EncodeOptions options;
    options.header.enabled = lengthHeaderEnabled;
    const QString mode = lengthMode.trimmed().toLower();
    options.header.format = parseLengthFormat(mode);
    options.header.size = lengthSize;
    options.allowBinaryPadding = allowBinaryPadding;
    options.allowNumericSanitize = allowNumericSanitize;
    if (lengthHeaderEnabled && options.header.format == LengthFormat::None) {
        return jsonError(QStringLiteral("Length header mode must be ascii or binary."));
    }

    EncodeResult encoded = Iso8583Codec::encode(fields, *packager, options);
    if (!encoded.ok) {
        return jsonError(QString::fromStdString(encoded.error));
    }

    const std::string rawHex = toHex(encoded.bytes, true);
    const QString rawText = QString::fromUtf8(reinterpret_cast<const char*>(encoded.bytes.data()),
                                             static_cast<int>(encoded.bytes.size()));

    QJsonObject obj;
    obj["ok"] = true;
    obj["raw"] = outputHex ? QString::fromStdString(rawHex) : rawText;
    obj["rawHex"] = QString::fromStdString(rawHex);
    obj["length"] = static_cast<int>(encoded.bytes.size());
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::calculateMacForFields(const QString& packagerName,
                                       const QString& fieldsJson,
                                       int macFieldId,
                                       const QString& keyHex,
                                       bool lengthHeaderEnabled,
                                       const QString& lengthMode,
                                       int lengthSize,
                                       const QString& paddingMode) {
    const Packager* packager = findPackager(packagerName);
    if (!packager) {
        return jsonError(QStringLiteral("Packager not found: %1").arg(packagerName));
    }
    if (macFieldId < 0) {
        return jsonError(QStringLiteral("MAC field id must be non-negative."));
    }

    std::map<int, std::string> fields;
    QString parseError;
    if (!parseFieldsArray(fieldsJson, fields, parseError)) {
        return jsonError(parseError);
    }
    fields.erase(macFieldId);

    EncodeOptions options;
    options.header.enabled = lengthHeaderEnabled;
    options.header.format = parseLengthFormat(lengthMode);
    options.header.size = lengthSize;
    if (lengthHeaderEnabled && options.header.format == LengthFormat::None) {
        return jsonError(QStringLiteral("Length header mode must be ascii or binary."));
    }

    const EncodeResult encoded = Iso8583Codec::encode(fields, *packager, options);
    if (!encoded.ok) {
        return jsonError(QString::fromStdString(encoded.error));
    }

    const int outputBytes = macOutputBytesForField(*packager, macFieldId);
    const MacResult mac = MacEngine::calculateAnsiX919(encoded.bytes,
                                                       keyHex.toStdString(),
                                                       parseMacPaddingMode(paddingMode),
                                                       outputBytes);
    if (!mac.ok) {
        return jsonError(QString::fromStdString(mac.error));
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["fieldId"] = macFieldId;
    obj["outputBytes"] = outputBytes;
    obj["payloadHex"] = QString::fromStdString(toHex(encoded.bytes, true));
    obj["macHex"] = QString::fromStdString(toHex(mac.macBytes, true));
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::verifyMacForFields(const QString& packagerName,
                                    const QString& fieldsJson,
                                    int macFieldId,
                                    const QString& keyHex,
                                    bool lengthHeaderEnabled,
                                    const QString& lengthMode,
                                    int lengthSize,
                                    const QString& paddingMode) {
    std::map<int, std::string> fields;
    QString parseError;
    if (!parseFieldsArray(fieldsJson, fields, parseError)) {
        return jsonError(parseError);
    }

    const auto providedIt = fields.find(macFieldId);
    if (providedIt == fields.end() || providedIt->second.empty()) {
        return jsonError(QStringLiteral("MAC field %1 is empty.").arg(macFieldId));
    }

    const QString calculatedText = calculateMacForFields(packagerName,
                                                         fieldsJson,
                                                         macFieldId,
                                                         keyHex,
                                                         lengthHeaderEnabled,
                                                         lengthMode,
                                                         lengthSize,
                                                         paddingMode);
    const QJsonObject calc = QJsonDocument::fromJson(calculatedText.toUtf8()).object();
    if (!calc.value("ok").toBool(false)) {
        return calculatedText;
    }

    const QString expected = calc.value("macHex").toString().toUpper();
    const QString provided = QString::fromStdString(providedIt->second).trimmed().toUpper();

    QJsonObject obj;
    obj["ok"] = true;
    obj["match"] = (expected == provided);
    obj["fieldId"] = macFieldId;
    obj["providedMacHex"] = provided;
    obj["expectedMacHex"] = expected;
    obj["payloadHex"] = calc.value("payloadHex").toString();
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::transformCrypto(const QString& algorithm,
                                 const QString& operation,
                                 const QString& payload,
                                 bool inputHex,
                                 const QString& keyHex,
                                 const QString& ivHex,
                                 bool usePadding) {
    std::vector<unsigned char> bytes;
    QString error;
    if (!parsePayloadBytes(payload, inputHex, bytes, error)) {
        return jsonError(error);
    }

    const QString op = operation.trimmed().toLower();
    if (op != "encrypt" && op != "decrypt") {
        return jsonError(QStringLiteral("Operation must be encrypt or decrypt."));
    }

    const CryptoResult transformed = CryptoEngine::transform(algorithm.toStdString(),
                                                             op == "encrypt",
                                                             bytes,
                                                             keyHex.toStdString(),
                                                             ivHex.toStdString(),
                                                             usePadding);
    if (!transformed.ok) {
        return jsonError(QString::fromStdString(transformed.error));
    }

    const QByteArray utf8(reinterpret_cast<const char*>(transformed.bytes.data()),
                          static_cast<int>(transformed.bytes.size()));
    QJsonObject obj;
    obj["ok"] = true;
    obj["rawHex"] = QString::fromStdString(toHex(transformed.bytes, true));
    obj["text"] = QString::fromUtf8(utf8);
    obj["length"] = static_cast<int>(transformed.bytes.size());
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::parseTlv(const QString& payload, bool inputHex) {
    std::vector<unsigned char> bytes;
    QString error;
    if (!parsePayloadBytes(payload, inputHex, bytes, error)) {
        return jsonError(error);
    }

    try {
        const std::vector<tlvtool::Node> nodes =
            tlvtool::parse(std::vector<uint8_t>(bytes.begin(), bytes.end()));

        QJsonArray nodeArray;
        for (const auto& node : nodes) {
            nodeArray.append(tlvNodeToJson(node, QString()));
        }

        const std::vector<tlvtool::FlatEntry> flatEntries = tlvtool::flatten(nodes);
        QJsonArray flatArray;
        for (const auto& entry : flatEntries) {
            QJsonObject obj;
            obj["path"] = QString::fromStdString(entry.path);
            obj["tagHex"] = QString::fromStdString(tlvtool::toHex(entry.tag, ' '));
            obj["length"] = static_cast<int>(entry.value.size());
            obj["valueHex"] = QString::fromStdString(tlvtool::toHex(entry.value, ' '));
            obj["valueText"] = QString::fromStdString(tlvtool::toAsciiDebug(entry.value));
            obj["description"] = QString::fromStdString(entry.description);
            flatArray.append(obj);
        }

        QJsonObject obj;
        obj["ok"] = true;
        obj["rawHex"] = QString::fromStdString(tlvtool::toHex(std::vector<uint8_t>(bytes.begin(), bytes.end()), ' '));
        obj["tree"] = nodeArray;
        obj["flat"] = flatArray;
        obj["treeText"] = QString::fromStdString(tlvtool::buildTreeText(nodes));
        obj["inlineText"] = QString::fromStdString(tlvtool::buildInlineText(nodes));
        return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
    } catch (const std::exception& ex) {
        return jsonError(QString::fromStdString(ex.what()));
    }
}

QString Backend::saveBufferFile(const QString& path,
                                const QString& packagerName,
                                const QString& fieldsJson,
                                const QString& raw,
                                bool rawIsHex,
                                bool autoDetect,
                                bool lengthHeaderEnabled,
                                const QString& lengthMode,
                                int lengthSize) {
    QJsonObject root;
    root["version"] = 1;
    root["packager"] = packagerName;
    root["raw"] = raw;
    root["rawFormat"] = rawIsHex ? QStringLiteral("hex") : QStringLiteral("text");

    QJsonObject header;
    header["enabled"] = lengthHeaderEnabled;
    header["auto"] = autoDetect;
    header["mode"] = lengthMode;
    header["size"] = lengthSize;
    root["lengthHeader"] = header;

    QJsonParseError parseError;
    QJsonDocument doc = QJsonDocument::fromJson(fieldsJson.toUtf8(), &parseError);
    if (parseError.error == QJsonParseError::NoError && doc.isArray()) {
        root["fields"] = doc.array();
    }

    QFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
        return jsonError(QStringLiteral("Failed to save buffer to %1").arg(path));
    }
    file.write(QJsonDocument(root).toJson(QJsonDocument::Indented));
    return QString::fromUtf8(QJsonDocument(QJsonObject{{"ok", true}}).toJson(QJsonDocument::Compact));
}

QString Backend::loadBufferFile(const QString& path) {
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        return jsonError(QStringLiteral("Failed to open buffer file: %1").arg(path));
    }

    const QByteArray data = file.readAll();
    QJsonParseError parseError;
    QJsonDocument doc = QJsonDocument::fromJson(data, &parseError);
    if (parseError.error != QJsonParseError::NoError || !doc.isObject()) {
        return jsonError(QStringLiteral("Buffer file is not valid JSON."));
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["buffer"] = doc.object();
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}
