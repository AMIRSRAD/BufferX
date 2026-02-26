#include "Backend.h"

#include "Hex.h"
#include "PackagerLoader.h"

#include <QFile>
#include <QFileDialog>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

#include <algorithm>
#include <map>

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
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["name"] = QString::fromStdString(packager->name);
    obj["lenLen"] = packager->lenLen;
    obj["lenFormat"] = QString::fromStdString(packager->lenFormat);
    obj["fieldCount"] = packager->fieldCount;
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

    QJsonParseError parseError;
    QJsonDocument document = QJsonDocument::fromJson(fieldsJson.toUtf8(), &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isArray()) {
        return jsonError(QStringLiteral("Invalid fields JSON."));
    }

    std::map<int, std::string> fields;
    const QJsonArray array = document.array();
    for (const QJsonValue& value : array) {
        if (!value.isObject()) {
            continue;
        }
        QJsonObject obj = value.toObject();
        const int id = obj.value("id").toInt(-1);
        const QString fieldValue = obj.value("value").toString();
        if (id < 0) {
            continue;
        }
        if (fieldValue.isEmpty() && id != 0) {
            continue;
        }
        const QByteArray utf8 = fieldValue.toUtf8();
        fields[id] = std::string(utf8.constData(), static_cast<size_t>(utf8.size()));
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
