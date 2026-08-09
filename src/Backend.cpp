#include "Backend.h"

#include "BankingTools.h"
#include "Crypto.h"
#include "Hex.h"
#include "IranSystem.h"
#include "Iso8583.h"
#include "Mac.h"
#include "Packager.h"
#include "PackagerLoader.h"
#include "PinBlock.h"
#include "PinVerification.h"
#include "PinTranslation.h"
#include "RsaSha.h"
#include "Tlv.h"

#include <QFile>
#include <QFileDialog>
#include <QElapsedTimer>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTcpSocket>
#include <QXmlStreamReader>
#include <QXmlStreamWriter>

#include <algorithm>
#include <map>

#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#endif

namespace {

void writeTlvXmlNode(QXmlStreamWriter& writer, const tlvtool::Node& node) {
    writer.writeStartElement(QStringLiteral("node"));
    writer.writeAttribute(QStringLiteral("tag"), QString::fromStdString(tlvtool::toHex(node.tag, 0)));
    const std::string pathDescription = tlvtool::describePath(tlvtool::toHex(node.tag, '/'));
    if (!pathDescription.empty()) {
        writer.writeAttribute(QStringLiteral("description"), QString::fromStdString(pathDescription));
    }
    if (node.isComposite()) {
        for (const tlvtool::Node& child : node.children) writeTlvXmlNode(writer, child);
    } else {
        writer.writeAttribute(QStringLiteral("valueHex"), QString::fromStdString(tlvtool::toHex(node.value, 0)));
    }
    writer.writeEndElement();
}

bool readTlvXmlNode(QXmlStreamReader& reader, tlvtool::Node& node, QString& error) {
    const QString tagText = reader.attributes().value(QStringLiteral("tag")).toString();
    const HexParseResult tag = fromHex(tagText.toStdString());
    if (!tag.ok || tag.bytes.empty()) {
        error = tag.ok ? QStringLiteral("TLV XML node has an empty tag.") : QString::fromStdString(tag.error);
        return false;
    }
    node.tag.assign(tag.bytes.begin(), tag.bytes.end());
    const bool constructed = node.isComposite();
    const QString valueText = reader.attributes().value(QStringLiteral("valueHex")).toString();
    if (constructed && !valueText.isEmpty()) {
        error = QStringLiteral("Constructed TLV tag %1 cannot have valueHex.").arg(tagText);
        return false;
    }

    while (reader.readNextStartElement()) {
        if (reader.name() != QStringLiteral("node")) {
            error = QStringLiteral("Unexpected TLV XML element: %1.").arg(reader.name().toString());
            return false;
        }
        if (!constructed) {
            error = QStringLiteral("Primitive TLV tag %1 cannot contain child nodes.").arg(tagText);
            return false;
        }
        tlvtool::Node child;
        if (!readTlvXmlNode(reader, child, error)) return false;
        node.children.push_back(std::move(child));
    }
    if (!constructed) {
        const HexParseResult value = fromHex(valueText.toStdString());
        if (!value.ok) {
            error = QString::fromStdString(value.error);
            return false;
        }
        node.value.assign(value.bytes.begin(), value.bytes.end());
    }
    return true;
}

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

std::vector<unsigned char> buildLegacyPartialMacPayload(const Packager& packager,
                                                        const std::map<int, std::string>& fields) {
    std::vector<int> ids;
    for (const auto& entry : fields) {
        ids.push_back(entry.first);
    }
    std::sort(ids.begin(), ids.end());

    std::vector<unsigned char> payload;
    for (int id : ids) {
        const auto defIt = packager.fields.find(id);
        if (defIt == packager.fields.end() || defIt->second.flags.empty() || defIt->second.flags[0] != '1') {
            continue;
        }
        const std::string& value = fields.at(id);
        payload.insert(payload.end(), value.begin(), value.end());
    }
    return payload;
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

struct BackendState {
    std::vector<Packager> packagers;
    bool legacyEngineMode = false;
};

Backend::Backend(QObject* parent) : QObject(parent), state_(std::make_unique<BackendState>()) {}

Backend::~Backend() = default;

void Backend::setLegacyEngineMode(bool enabled) {
    state_->legacyEngineMode = enabled;
}

bool Backend::legacyEngineMode() const {
    return state_->legacyEngineMode;
}

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
    for (auto& packager : state_->packagers) {
        if (QString::fromStdString(packager.name) == name) {
            return &packager;
        }
    }
    return nullptr;
}

const Packager* Backend::findPackager(const QString& name) const {
    for (const auto& packager : state_->packagers) {
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

    state_->packagers = loadResult.packagers;
    QJsonArray names;
    for (const auto& packager : state_->packagers) {
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

QString Backend::atmEngineIranSystemToUnicode(const QString& payload, bool inputHex) const {
    std::vector<unsigned char> bytes;
    QString error;
    if (!parsePayloadBytes(payload, inputHex, bytes, error)) return jsonError(error);
    const iransystem::ConversionResult converted = iransystem::toAtmEngineUnicode(bytes);
    if (!converted.ok) return jsonError(converted.error);

    QJsonObject obj;
    obj["ok"] = true;
    obj["text"] = converted.text;
    obj["rawHex"] = QString::fromStdString(toHex(bytes, true));
    obj["length"] = static_cast<int>(bytes.size());
    obj["profile"] = QStringLiteral("ATM Engine W2IS");
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::unicodeToAtmEngineIranSystem(const QString& text, bool convertNumbers) const {
    const iransystem::ConversionResult converted = iransystem::fromUnicodeAtmEngine(text, convertNumbers);
    if (!converted.ok) return jsonError(converted.error);

    QJsonObject obj;
    obj["ok"] = true;
    obj["text"] = text;
    obj["rawHex"] = QString::fromStdString(toHex(converted.bytes, true));
    obj["length"] = static_cast<int>(converted.bytes.size());
    obj["profile"] = QStringLiteral("ATM Engine W2IS");
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

QString Backend::runBankingUtility(const QString& operation,
                                   const QString& input,
                                   const QString& secondary,
                                   int parameter) const {
    const QByteArray inputUtf8 = input.toUtf8();
    const QByteArray secondaryUtf8 = secondary.toUtf8();
    const BankingToolResult result = bankingtools::run(operation.toStdString(),
                                                       std::string(inputUtf8.constData(), inputUtf8.size()),
                                                       std::string(secondaryUtf8.constData(), secondaryUtf8.size()),
                                                       parameter);
    if (!result.ok) {
        return jsonError(QString::fromStdString(result.error));
    }
    QJsonObject obj;
    obj["ok"] = true;
    obj["output"] = QString::fromUtf8(result.output.data(), static_cast<int>(result.output.size()));
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::createIso0PinBlock(const QString& pin, const QString& pan) const {
    const PinBlockResult created = pinblock::createIso0(pin.toStdString(), pan.toStdString());
    if (!created.ok) {
        return jsonError(QString::fromStdString(created.error));
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["pin"] = QString::fromStdString(created.pin);
    obj["pinBlockHex"] = QString::fromStdString(toHex(created.bytes, true));
    obj["length"] = static_cast<int>(created.bytes.size());
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::decodeIso0PinBlock(const QString& pinBlockHex, const QString& pan) const {
    const HexParseResult parsed = fromHex(pinBlockHex.toStdString());
    if (!parsed.ok) {
        return jsonError(QString::fromStdString(parsed.error));
    }

    const PinBlockResult decoded = pinblock::decodeIso0(parsed.bytes, pan.toStdString());
    if (!decoded.ok) {
        return jsonError(QString::fromStdString(decoded.error));
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["pin"] = QString::fromStdString(decoded.pin);
    obj["pinBlockHex"] = QString::fromStdString(toHex(decoded.bytes, true));
    obj["length"] = static_cast<int>(decoded.bytes.size());
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::createPinBlock(const QString& format,
                                const QString& pin,
                                const QString& pan,
                                const QString& keyHex) const {
    const QString normalized = format.trimmed().toUpper().remove(QStringLiteral("ISO-")).remove(' ');
    PinBlockResult created;
    if (normalized == "0") {
        created = pinblock::createIso0(pin.toStdString(), pan.toStdString());
    } else if (normalized == "1") {
        created = pinblock::createIso1(pin.toStdString());
    } else if (normalized == "3") {
        created = pinblock::createIso3(pin.toStdString(), pan.toStdString());
    } else if (normalized == "4") {
        created = pinblock::encryptIso4(pin.toStdString(), pan.toStdString(), keyHex.toStdString());
    } else {
        return jsonError(QStringLiteral("Unsupported PIN block format. Use ISO-0, ISO-1, ISO-3, or ISO-4."));
    }
    if (!created.ok) return jsonError(QString::fromStdString(created.error));

    QJsonObject obj;
    obj["ok"] = true;
    obj["format"] = QStringLiteral("ISO-") + normalized;
    obj["pin"] = QString::fromStdString(created.pin);
    obj["pinBlockHex"] = QString::fromStdString(toHex(created.bytes, true));
    obj["encrypted"] = normalized == "4";
    obj["length"] = static_cast<int>(created.bytes.size());
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::decodePinBlock(const QString& format,
                                const QString& pinBlockHex,
                                const QString& pan,
                                const QString& keyHex) const {
    const HexParseResult parsed = fromHex(pinBlockHex.toStdString());
    if (!parsed.ok) return jsonError(QString::fromStdString(parsed.error));

    const QString normalized = format.trimmed().toUpper().remove(QStringLiteral("ISO-")).remove(' ');
    PinBlockResult decoded;
    if (normalized == "0") {
        decoded = pinblock::decodeIso0(parsed.bytes, pan.toStdString());
    } else if (normalized == "1") {
        decoded = pinblock::decodeIso1(parsed.bytes);
    } else if (normalized == "3") {
        decoded = pinblock::decodeIso3(parsed.bytes, pan.toStdString());
    } else if (normalized == "4") {
        decoded = pinblock::decryptIso4(parsed.bytes, pan.toStdString(), keyHex.toStdString());
    } else {
        return jsonError(QStringLiteral("Unsupported PIN block format. Use ISO-0, ISO-1, ISO-3, or ISO-4."));
    }
    if (!decoded.ok) return jsonError(QString::fromStdString(decoded.error));

    QJsonObject obj;
    obj["ok"] = true;
    obj["format"] = QStringLiteral("ISO-") + normalized;
    obj["pin"] = QString::fromStdString(decoded.pin);
    obj["pinBlockHex"] = QString::fromStdString(toHex(decoded.bytes, true));
    obj["encrypted"] = normalized == "4";
    obj["length"] = static_cast<int>(decoded.bytes.size());
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::encryptPinBlock(const QString& pinBlockHex, const QString& keyHex) const {
    const HexParseResult parsed = fromHex(pinBlockHex.toStdString());
    if (!parsed.ok) {
        return jsonError(QString::fromStdString(parsed.error));
    }

    const CryptoResult encrypted = CryptoEngine::transform("3des-ecb",
                                                           true,
                                                           parsed.bytes,
                                                           keyHex.toStdString(),
                                                           std::string(),
                                                           false);
    if (!encrypted.ok) {
        return jsonError(QString::fromStdString(encrypted.error));
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["pinBlockHex"] = QString::fromStdString(toHex(encrypted.bytes, true));
    obj["length"] = static_cast<int>(encrypted.bytes.size());
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::decryptPinBlock(const QString& encryptedPinBlockHex, const QString& keyHex) const {
    const HexParseResult parsed = fromHex(encryptedPinBlockHex.toStdString());
    if (!parsed.ok) {
        return jsonError(QString::fromStdString(parsed.error));
    }

    const CryptoResult decrypted = CryptoEngine::transform("3des-ecb",
                                                           false,
                                                           parsed.bytes,
                                                           keyHex.toStdString(),
                                                           std::string(),
                                                           false);
    if (!decrypted.ok) {
        return jsonError(QString::fromStdString(decrypted.error));
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["pinBlockHex"] = QString::fromStdString(toHex(decrypted.bytes, true));
    obj["length"] = static_cast<int>(decrypted.bytes.size());
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::calculateVisaPvv(const QString& pin,
                                  const QString& pan,
                                  const QString& pvki,
                                  const QString& pvkHex) const {
    const PinVerificationResult result = pinverification::visaPvv(
        pin.toStdString(), pan.toStdString(), pvki.toStdString(), pvkHex.toStdString());
    if (!result.ok) return jsonError(QString::fromStdString(result.error));
    QJsonObject obj;
    obj["ok"] = true;
    obj["pvv"] = QString::fromStdString(result.value);
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::calculateIbm3624Offset(const QString& pin,
                                        const QString& validationData,
                                        const QString& decimalizationTable,
                                        const QString& pvkHex) const {
    const PinVerificationResult result = pinverification::ibm3624Offset(
        pin.toStdString(), validationData.toStdString(), decimalizationTable.toStdString(), pvkHex.toStdString());
    if (!result.ok) return jsonError(QString::fromStdString(result.error));
    QJsonObject obj;
    obj["ok"] = true;
    obj["offset"] = QString::fromStdString(result.value);
    obj["naturalPin"] = QString::fromStdString(result.naturalPin);
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::verifyIbm3624Pin(const QString& pin,
                                  const QString& offset,
                                  const QString& validationData,
                                  const QString& decimalizationTable,
                                  const QString& pvkHex) const {
    const PinVerificationResult result = pinverification::verifyIbm3624(
        pin.toStdString(), offset.toStdString(), validationData.toStdString(),
        decimalizationTable.toStdString(), pvkHex.toStdString());
    if (!result.ok) return jsonError(QString::fromStdString(result.error));
    QJsonObject obj;
    obj["ok"] = true;
    obj["match"] = result.value == "VALID";
    obj["status"] = QString::fromStdString(result.value);
    obj["naturalPin"] = QString::fromStdString(result.naturalPin);
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::translateAtmPinBlock(const QString& encryptedBlockHex,
                                      const QString& pan,
                                      const QString& sourceFormat,
                                      const QString& sourceAlgorithm,
                                      const QString& sourceKeyHex,
                                      const QString& destinationFormat,
                                      const QString& destinationAlgorithm,
                                      const QString& destinationKeyHex) const {
    const HexParseResult block = fromHex(encryptedBlockHex.toStdString());
    if (!block.ok) return jsonError(QString::fromStdString(block.error));
    const PinTranslationResult translated = pintranslation::translate(
        block.bytes, pan.toStdString(), sourceFormat.toStdString(), sourceAlgorithm.toStdString(),
        sourceKeyHex.toStdString(), destinationFormat.toStdString(), destinationAlgorithm.toStdString(),
        destinationKeyHex.toStdString());
    if (!translated.ok) return jsonError(QString::fromStdString(translated.error));

    QJsonObject obj;
    obj["ok"] = true;
    obj["translatedPinBlockHex"] = QString::fromStdString(toHex(translated.translatedBlock, true));
    obj["sourceFormat"] = sourceFormat;
    obj["sourceAlgorithm"] = sourceAlgorithm;
    obj["destinationFormat"] = destinationFormat;
    obj["destinationAlgorithm"] = destinationAlgorithm;
    obj["length"] = static_cast<int>(translated.translatedBlock.size());
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::signRsaShaBase64(const QString& payload,
                                  const QString& privateKeyPem,
                                  const QString& digestName) const {
    const RsaShaResult signedResult = rsasha::signBase64(payload.toUtf8().toStdString(),
                                                         privateKeyPem.toStdString(),
                                                         digestName.toStdString());
    if (!signedResult.ok) {
        return jsonError(QString::fromStdString(signedResult.error));
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["signatureBase64"] = QString::fromStdString(signedResult.base64);
    obj["digest"] = digestName;
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::verifyRsaShaBase64(const QString& payload,
                                    const QString& publicKeyPem,
                                    const QString& signatureBase64,
                                    const QString& digestName) const {
    const RsaShaResult verifiedResult = rsasha::verifyBase64(payload.toUtf8().toStdString(),
                                                             publicKeyPem.toStdString(),
                                                             signatureBase64.toStdString(),
                                                             digestName.toStdString());
    if (!verifiedResult.ok) {
        return jsonError(QString::fromStdString(verifiedResult.error));
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["match"] = verifiedResult.verified;
    obj["digest"] = digestName;
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::encryptRsaBase64(const QString& payload,
                                  const QString& publicKeyPem,
                                  const QString& paddingName) const {
    const QByteArray payloadBytes = payload.toUtf8();
    const RsaCipherResult encrypted = rsasha::encryptBase64(
        std::string(payloadBytes.constData(), static_cast<size_t>(payloadBytes.size())),
        publicKeyPem.toStdString(),
        paddingName.toStdString());
    if (!encrypted.ok) {
        return jsonError(QString::fromStdString(encrypted.error));
    }
    QJsonObject obj;
    obj["ok"] = true;
    obj["ciphertextBase64"] = QString::fromStdString(encrypted.base64);
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::decryptRsaBase64(const QString& ciphertextBase64,
                                  const QString& privateKeyPem,
                                  const QString& paddingName) const {
    const RsaCipherResult decrypted = rsasha::decryptBase64(ciphertextBase64.toStdString(),
                                                            privateKeyPem.toStdString(),
                                                            paddingName.toStdString());
    if (!decrypted.ok) {
        return jsonError(QString::fromStdString(decrypted.error));
    }
    QJsonObject obj;
    obj["ok"] = true;
    obj["plaintext"] = QString::fromUtf8(decrypted.plaintext.data(), static_cast<int>(decrypted.plaintext.size()));
    obj["plaintextHex"] = QString::fromStdString(toHex(
        std::vector<unsigned char>(decrypted.plaintext.begin(), decrypted.plaintext.end()), true));
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
    options.legacyEngine = state_->legacyEngineMode;
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
    options.legacyEngine = state_->legacyEngineMode;
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
    options.legacyEngine = state_->legacyEngineMode;
    if (lengthHeaderEnabled && options.header.format == LengthFormat::None) {
        return jsonError(QStringLiteral("Length header mode must be ascii or binary."));
    }

    std::vector<unsigned char> macPayload;
    if (state_->legacyEngineMode && QString::fromStdString(packager->macMethod).compare(QStringLiteral("PARTIAL"),
                                                                                Qt::CaseInsensitive) == 0) {
        macPayload = buildLegacyPartialMacPayload(*packager, fields);
    } else {
        const EncodeResult encoded = Iso8583Codec::encode(fields, *packager, options);
        if (!encoded.ok) {
            return jsonError(QString::fromStdString(encoded.error));
        }
        macPayload = encoded.bytes;
    }

    const int outputBytes = macOutputBytesForField(*packager, macFieldId);
    const MacResult mac = MacEngine::calculateAnsiX919(macPayload,
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
    obj["payloadHex"] = QString::fromStdString(toHex(macPayload, true));
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

QString Backend::validateTlv(const QString& payload, bool inputHex) const {
    std::vector<unsigned char> bytes;
    QString error;
    if (!parsePayloadBytes(payload, inputHex, bytes, error)) return jsonError(error);
    if (bytes.empty()) return jsonError(QStringLiteral("TLV payload must not be empty."));
    try {
        const std::vector<tlvtool::Node> nodes =
            tlvtool::parse(std::vector<uint8_t>(bytes.begin(), bytes.end()));
        QJsonObject obj;
        obj["ok"] = true;
        obj["valid"] = true;
        obj["nodeCount"] = static_cast<int>(tlvtool::flatten(nodes).size());
        return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
    } catch (const std::exception& ex) {
        return jsonError(QString::fromStdString(ex.what()));
    }
}

QString Backend::tlvToXml(const QString& payload, bool inputHex) const {
    std::vector<unsigned char> bytes;
    QString error;
    if (!parsePayloadBytes(payload, inputHex, bytes, error)) return jsonError(error);
    if (bytes.empty()) return jsonError(QStringLiteral("TLV payload must not be empty."));
    try {
        const std::vector<tlvtool::Node> nodes =
            tlvtool::parse(std::vector<uint8_t>(bytes.begin(), bytes.end()));
        QString xml;
        QXmlStreamWriter writer(&xml);
        writer.setAutoFormatting(true);
        writer.writeStartDocument();
        writer.writeStartElement(QStringLiteral("tlv"));
        for (const tlvtool::Node& node : nodes) writeTlvXmlNode(writer, node);
        writer.writeEndElement();
        writer.writeEndDocument();

        QJsonObject obj;
        obj["ok"] = true;
        obj["xml"] = xml;
        obj["rawHex"] = QString::fromStdString(tlvtool::toHex(
            std::vector<uint8_t>(bytes.begin(), bytes.end()), ' '));
        return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
    } catch (const std::exception& ex) {
        return jsonError(QString::fromStdString(ex.what()));
    }
}

QString Backend::xmlToTlv(const QString& xml) const {
    QXmlStreamReader reader(xml);
    if (!reader.readNextStartElement() || reader.name() != QStringLiteral("tlv")) {
        return jsonError(QStringLiteral("TLV XML must have a <tlv> root element."));
    }

    std::vector<tlvtool::Node> nodes;
    QString error;
    while (reader.readNextStartElement()) {
        if (reader.name() != QStringLiteral("node")) {
            return jsonError(QStringLiteral("Unexpected TLV XML element: %1.").arg(reader.name().toString()));
        }
        tlvtool::Node node;
        if (!readTlvXmlNode(reader, node, error)) return jsonError(error);
        nodes.push_back(std::move(node));
    }
    if (reader.hasError()) return jsonError(reader.errorString());
    if (nodes.empty()) return jsonError(QStringLiteral("TLV XML must contain at least one node."));

    std::vector<uint8_t> encoded;
    try {
        for (const tlvtool::Node& node : nodes) {
            const std::vector<uint8_t> nodeBytes = node.encode();
            encoded.insert(encoded.end(), nodeBytes.begin(), nodeBytes.end());
        }
        // Reparse the exact output to verify all encoded boundaries.
        (void)tlvtool::parse(encoded);
    } catch (const std::exception& ex) {
        return jsonError(QString::fromStdString(ex.what()));
    }

    QJsonObject obj;
    obj["ok"] = true;
    obj["rawHex"] = QString::fromStdString(tlvtool::toHex(encoded, ' '));
    obj["treeText"] = QString::fromStdString(tlvtool::buildTreeText(nodes));
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::sendTcpRequest(const QString& host,
                                int port,
                                const QString& payload,
                                bool inputHex,
                                const QString& framing,
                                int headerSize,
                                int timeoutMs) const {
    if (host.trimmed().isEmpty()) return jsonError(QStringLiteral("TCP host must not be empty."));
    if (port < 1 || port > 65535) return jsonError(QStringLiteral("TCP port must be between 1 and 65535."));
    if (timeoutMs < 100 || timeoutMs > 120000) {
        return jsonError(QStringLiteral("TCP timeout must be between 100 and 120000 ms."));
    }

    std::vector<unsigned char> parsed;
    QString error;
    if (!parsePayloadBytes(payload, inputHex, parsed, error)) return jsonError(error);
    if (parsed.empty()) return jsonError(QStringLiteral("TCP request payload must not be empty."));
    QByteArray body(reinterpret_cast<const char*>(parsed.data()), static_cast<int>(parsed.size()));
    QByteArray request = body;
    const QString mode = framing.trimmed().toLower();
    if (mode != "none") {
        if (headerSize < 1 || headerSize > 8 || (mode == "binary" && headerSize > 4)) {
            return jsonError(QStringLiteral("Header size must be 1-8 ASCII bytes or 1-4 binary bytes."));
        }
        QByteArray header;
        if (mode == "ascii") {
            const QByteArray digits = QByteArray::number(body.size());
            if (digits.size() > headerSize) return jsonError(QStringLiteral("Payload length does not fit the ASCII header."));
            header = digits.rightJustified(headerSize, '0');
        } else if (mode == "binary") {
            const quint64 maximum = (quint64{1} << (headerSize * 8)) - 1;
            if (static_cast<quint64>(body.size()) > maximum) {
                return jsonError(QStringLiteral("Payload length does not fit the binary header."));
            }
            header.resize(headerSize);
            quint64 length = static_cast<quint64>(body.size());
            for (int i = headerSize - 1; i >= 0; --i) {
                header[i] = static_cast<char>(length & 0xFFu);
                length >>= 8;
            }
        } else {
            return jsonError(QStringLiteral("TCP framing must be none, ascii, or binary."));
        }
        request.prepend(header);
    }

    QTcpSocket socket;
    QElapsedTimer timer;
    timer.start();
    socket.connectToHost(host.trimmed(), static_cast<quint16>(port));
    if (!socket.waitForConnected(timeoutMs)) return jsonError(QStringLiteral("TCP connect failed: %1").arg(socket.errorString()));
    if (socket.write(request) != request.size() || !socket.waitForBytesWritten(std::max(1, timeoutMs - static_cast<int>(timer.elapsed())))) {
        return jsonError(QStringLiteral("TCP write failed: %1").arg(socket.errorString()));
    }

    QByteArray response;
    qint64 expectedSize = -1;
    while (timer.elapsed() < timeoutMs) {
        const int remaining = timeoutMs - static_cast<int>(timer.elapsed());
        if (socket.bytesAvailable() == 0 && !socket.waitForReadyRead(mode == "none" && !response.isEmpty()
                                                                     ? std::min(150, remaining)
                                                                     : remaining)) {
            if (mode == "none" && !response.isEmpty()) break;
            if (socket.state() == QAbstractSocket::UnconnectedState && !response.isEmpty()) break;
            return jsonError(QStringLiteral("TCP read failed or timed out: %1").arg(socket.errorString()));
        }
        response += socket.readAll();
        if (mode != "none" && expectedSize < 0 && response.size() >= headerSize) {
            qint64 payloadSize = 0;
            if (mode == "ascii") {
                bool ok = false;
                payloadSize = response.left(headerSize).toLongLong(&ok, 10);
                if (!ok || payloadSize < 0) return jsonError(QStringLiteral("Response has an invalid ASCII length header."));
            } else {
                for (int i = 0; i < headerSize; ++i) {
                    payloadSize = (payloadSize << 8) | static_cast<unsigned char>(response[i]);
                }
            }
            expectedSize = headerSize + payloadSize;
        }
        if (expectedSize >= 0 && response.size() >= expectedSize) break;
    }
    if (response.isEmpty()) return jsonError(QStringLiteral("TCP peer returned no data."));
    if (expectedSize >= 0 && response.size() < expectedSize) {
        return jsonError(QStringLiteral("TCP response ended before the framed payload was complete."));
    }
    if (expectedSize >= 0 && response.size() > expectedSize) response.truncate(expectedSize);

    const QByteArray responseBody = mode == "none" ? response : response.mid(headerSize);
    const std::vector<unsigned char> responseBytes(response.begin(), response.end());
    const std::vector<unsigned char> responseBodyBytes(responseBody.begin(), responseBody.end());
    QJsonObject obj;
    obj["ok"] = true;
    obj["elapsedMs"] = static_cast<int>(timer.elapsed());
    obj["requestWireHex"] = QString::fromStdString(toHex(
        std::vector<unsigned char>(request.begin(), request.end()), true));
    obj["responseWireHex"] = QString::fromStdString(toHex(responseBytes, true));
    obj["responseHex"] = QString::fromStdString(toHex(responseBodyBytes, true));
    obj["responseText"] = QString::fromUtf8(responseBody);
    obj["responseLength"] = responseBody.size();
    return QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact));
}

QString Backend::buildTlv(const QString& tagHex,
                          const QString& payload,
                          bool valueIsHex,
                          bool constructed) {
    const HexParseResult tagParsed = fromHex(tagHex.toStdString());
    if (!tagParsed.ok) {
        return jsonError(QStringLiteral("Invalid tag hex: %1").arg(QString::fromStdString(tagParsed.error)));
    }
    if (tagParsed.bytes.empty()) {
        return jsonError(QStringLiteral("Tag hex must not be empty."));
    }

    tlvtool::Node node;
    node.tag.assign(tagParsed.bytes.begin(), tagParsed.bytes.end());

    try {
        if (constructed) {
            HexParseResult childParsed = fromHex(payload.toStdString());
            if (!childParsed.ok) {
                return jsonError(QStringLiteral("Constructed payload must be valid hex: %1")
                                     .arg(QString::fromStdString(childParsed.error)));
            }
            const std::vector<uint8_t> childBytes(childParsed.bytes.begin(), childParsed.bytes.end());
            node.children = tlvtool::parse(childBytes);
        } else if (valueIsHex) {
            HexParseResult valueParsed = fromHex(payload.toStdString());
            if (!valueParsed.ok) {
                return jsonError(QStringLiteral("Value must be valid hex: %1").arg(QString::fromStdString(valueParsed.error)));
            }
            node.value.assign(valueParsed.bytes.begin(), valueParsed.bytes.end());
        } else {
            const QByteArray utf8 = payload.toUtf8();
            node.value.assign(utf8.begin(), utf8.end());
        }

        const std::vector<tlvtool::Node> nodes = { node };
        const std::vector<uint8_t> encoded = node.encode();
        const std::vector<tlvtool::FlatEntry> flatEntries = tlvtool::flatten(nodes);
        QJsonArray nodeArray;
        nodeArray.append(tlvNodeToJson(node, QString()));

        QJsonArray flatArray;
        for (const auto& entry : flatEntries) {
            QJsonObject flatObj;
            flatObj["path"] = QString::fromStdString(entry.path);
            flatObj["tagHex"] = QString::fromStdString(tlvtool::toHex(entry.tag, ' '));
            flatObj["length"] = static_cast<int>(entry.value.size());
            flatObj["valueHex"] = QString::fromStdString(tlvtool::toHex(entry.value, ' '));
            flatObj["valueText"] = QString::fromStdString(tlvtool::toAsciiDebug(entry.value));
            flatObj["description"] = QString::fromStdString(entry.description);
            flatArray.append(flatObj);
        }

        QJsonObject obj;
        obj["ok"] = true;
        obj["rawHex"] = QString::fromStdString(tlvtool::toHex(encoded, ' '));
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
