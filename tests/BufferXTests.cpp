#include <QCoreApplication>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTemporaryDir>

#include <cstdlib>
#include <exception>
#include <functional>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#endif

#include "Backend.h"
#include "Crypto.h"
#include "Hex.h"
#include "Iso8583.h"
#include "Mac.h"
#include "Packager.h"
#include "PackagerLoader.h"
#include "Tlv.h"

namespace {

struct TestFailure : std::runtime_error {
    using std::runtime_error::runtime_error;
};

void require(bool condition, const std::string& message) {
    if (!condition) {
        throw TestFailure(message);
    }
}

std::string toStdString(const QString& value) {
    const QByteArray utf8 = value.toUtf8();
    return std::string(utf8.constData(), static_cast<size_t>(utf8.size()));
}

QString sourcePath(const QString& relativePath) {
    return QStringLiteral(BUFFERX_SOURCE_DIR) + QLatin1Char('/') + relativePath;
}

QByteArray readFile(const QString& path) {
    QFile file(path);
    require(file.open(QIODevice::ReadOnly), "Failed to open file: " + toStdString(path));
    return file.readAll();
}

QJsonObject parseJsonObject(const QString& jsonText) {
    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(jsonText.toUtf8(), &error);
    require(error.error == QJsonParseError::NoError, "Invalid JSON: " + toStdString(error.errorString()));
    require(document.isObject(), "Expected a JSON object.");
    return document.object();
}

QJsonObject requireOk(const QString& jsonText) {
    const QJsonObject obj = parseJsonObject(jsonText);
    require(obj.value("ok").toBool(false), "Backend returned error: " + toStdString(obj.value("error").toString()));
    return obj;
}

QJsonArray sampleFieldsJson() {
    static const char* kFields = R"json(
[
  { "id": 0, "value": "0200" },
  { "id": 2, "value": "5892101038910408" },
  { "id": 3, "value": "400000" },
  { "id": 4, "value": "000000000001" },
  { "id": 5, "value": "2131" },
  { "id": 7, "value": "0614081457" },
  { "id": 11, "value": "000127" },
  { "id": 12, "value": "124457" },
  { "id": 13, "value": "0614" },
  { "id": 14, "value": "9701" },
  { "id": 22, "value": "021" },
  { "id": 24, "value": "200" },
  { "id": 25, "value": "43" },
  { "id": 32, "value": "603799" },
  { "id": 33, "value": "589210" },
  { "id": 35, "value": "3892101038910408=97015010000015170" },
  { "id": 37, "value": "000000000127" },
  { "id": 41, "value": "10201364" },
  { "id": 42, "value": "710011065 026 0" },
  { "id": 48, "value": "6037997278862249" },
  { "id": 49, "value": "364" },
  { "id": 52, "value": "A5AFB1F93E59A8F3" },
  { "id": 100, "value": "589210" },
  { "id": 128, "value": "75F69359DFBAE8D4" }
]
)json";
    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(QByteArray(kFields), &error);
    require(error.error == QJsonParseError::NoError, "Failed to parse embedded sample fields JSON.");
    require(document.isArray(), "Embedded sample fields payload is not an array.");
    return document.array();
}

QString sampleFieldsString() {
    return QString::fromUtf8(QJsonDocument(sampleFieldsJson()).toJson(QJsonDocument::Compact));
}

QString sampleRawText() {
    return QStringLiteral("02590200F23C0581A8C190000000000010000001165892101038910408400000000000000001061408145700012712445706149701021200430660379906589210345892101038910408=9701501000001517000000000012710201364710011065 026 00166037997278862249364A5AFB1F93E59A8F30658921075F69359DFBAE8D4");
}

Packager loadPackagerByName(const std::string& name) {
    const QByteArray xml = readFile(sourcePath(QStringLiteral("data/packagers.xml")));
    const PackagerLoadResult result = PackagerLoader::loadFromXml(xml.toStdString());
    require(result.ok, "Failed to load packagers: " + result.error);
    for (const Packager& packager : result.packagers) {
        if (packager.name == name) {
            return packager;
        }
    }
    throw TestFailure("Packager not found: " + name);
}

std::map<int, std::string> fieldsFromJson(const QJsonArray& array) {
    std::map<int, std::string> fields;
    for (const QJsonValue& value : array) {
        const QJsonObject obj = value.toObject();
        const int id = obj.value("id").toInt(-1);
        require(id >= 0, "Sample field missing id.");
        fields[id] = toStdString(obj.value("value").toString());
    }
    return fields;
}

bool isMacFieldId(int id) {
    return id == 64 || id == 96 || id == 128;
}

std::map<int, std::string> removeMacFields(const std::map<int, std::string>& fields) {
    std::map<int, std::string> filtered;
    for (const auto& entry : fields) {
        if (!isMacFieldId(entry.first)) {
            filtered.insert(entry);
        }
    }
    return filtered;
}

QJsonArray removeMacFields(const QJsonArray& fields) {
    QJsonArray filtered;
    for (const QJsonValue& value : fields) {
        const QJsonObject obj = value.toObject();
        if (!isMacFieldId(obj.value("id").toInt(-1))) {
            filtered.append(obj);
        }
    }
    return filtered;
}

std::string canonicalFieldValue(const FieldDef& def, const std::string& value) {
    if (def.variable || def.length <= 0) {
        return value;
    }
    if (def.type == FieldType::NumericFixed || def.type == FieldType::Amount) {
        if (value.size() >= static_cast<size_t>(def.length)) {
            return value;
        }
        return std::string(static_cast<size_t>(def.length) - value.size(), '0') + value;
    }
    if (def.type == FieldType::CharFixed) {
        if (value.size() >= static_cast<size_t>(def.length)) {
            return value;
        }
        return value + std::string(static_cast<size_t>(def.length) - value.size(), ' ');
    }
    return value;
}

void testHexRoundTrip() {
    const HexParseResult parsed = fromHex("0a 1B ff");
    require(parsed.ok, "Expected valid hex parse.");
    require(parsed.bytes.size() == 3, "Expected three bytes.");
    require(parsed.bytes[0] == 0x0A && parsed.bytes[1] == 0x1B && parsed.bytes[2] == 0xFF,
            "Unexpected parsed hex bytes.");
    require(toHex(parsed.bytes, true) == "0A1BFF", "Unexpected uppercase hex output.");
    require(toHex(parsed.bytes, false) == "0a1bff", "Unexpected lowercase hex output.");
}

void testHexFailures() {
    const HexParseResult odd = fromHex("ABC");
    require(!odd.ok, "Odd digit count should fail.");
    require(odd.error == "Odd number of hex digits.", "Unexpected odd-digit error.");

    const HexParseResult invalid = fromHex("GG");
    require(!invalid.ok, "Invalid hex should fail.");
    require(invalid.error == "Invalid hex character.", "Unexpected invalid-character error.");
}

void testFieldTypeMapping() {
    require(parseFieldType("IFA_NUMERIC") == FieldType::NumericFixed, "IFA_NUMERIC mapping failed.");
    require(parseFieldType("IFB_LLNUM_BCD") == FieldType::LlNum, "IFB_LLNUM_BCD mapping failed.");
    require(parseFieldType("IFA_LLLBINARY") == FieldType::BinaryLll, "IFA_LLLBINARY mapping failed.");
    require(parseFieldType("IFA_HHHHCHAR") == FieldType::LlllChar, "IFA_HHHHCHAR mapping failed.");
    require(parseFieldType("IFA_LLLLCHAR") == FieldType::LlllChar, "IFA_LLLLCHAR mapping failed.");
    require(parseFieldType("IFA_LLLLLLCHAR") == FieldType::LlllllChar, "IFA_LLLLLLCHAR mapping failed.");
    require(parseFieldType("IFA_LLLLBINARY") == FieldType::BinaryLlll, "IFA_LLLLBINARY mapping failed.");
    require(lengthDigitsForFieldType(FieldType::LlChar) == 2, "LLCHAR length digits mismatch.");
    require(lengthDigitsForFieldType(FieldType::LllChar) == 3, "LLLCHAR length digits mismatch.");
    require(lengthDigitsForFieldType(FieldType::LlllChar) == 4, "LLLLCHAR length digits mismatch.");
    require(lengthDigitsForFieldType(FieldType::LlllllChar) == 6, "LLLLLLCHAR length digits mismatch.");
    require(lengthDigitsForFieldType(FieldType::BinaryLlll) == 4, "LLLLBINARY length digits mismatch.");
    require(isVariableLength(FieldType::BinaryFixed) == false, "BinaryFixed should not be variable length.");
}

void testPackagerLoader() {
    const QByteArray xml = readFile(sourcePath(QStringLiteral("data/packagers.xml")));
    const PackagerLoadResult result = PackagerLoader::loadFromXml(xml.toStdString());
    require(result.ok, "PackagerLoader failed.");
    require(result.packagers.size() == 32, "Unexpected packager count.");

    const Packager slm = loadPackagerByName("SLM");
    require(slm.lenLen == 4, "SLM LenLen mismatch.");
    require(slm.fieldCount == 128, "SLM field count mismatch.");
    require(slm.fields.at(52).type == FieldType::BinaryFixed, "Field 52 should be binary.");
    require(slm.fields.at(35).type == FieldType::LlNum, "Field 35 should be LLNUM.");

    const Packager dataset = loadPackagerByName("DATASET");
    require(dataset.fields.at(1).type == FieldType::LlllChar, "DATASET field type mapping mismatch.");
}

void testPackagerLoaderFailures() {
    {
        const std::string xml = "<Packagers><Packager MacSize=\"1\"></Packager></Packagers>";
        const PackagerLoadResult result = PackagerLoader::loadFromXml(xml);
        require(!result.ok, "Missing packager name should fail.");
        require(result.error.find("missing required attribute 'Name'") != std::string::npos,
                "Unexpected missing-packager-name error.");
    }

    {
        const std::string xml =
            "<Packagers><Packager Name=\"Broken\"><Field FieldId=\"ABC\" FieldType=\"IF_CHAR\" /></Packager></Packagers>";
        const PackagerLoadResult result = PackagerLoader::loadFromXml(xml);
        require(!result.ok, "Invalid field id should fail.");
        require(result.error.find("invalid integer value for attribute 'FieldId'") != std::string::npos,
                "Unexpected invalid-field-id error.");
    }

    {
        const std::string xml = "<Packagers><Packager Name=\"Broken\">";
        const PackagerLoadResult result = PackagerLoader::loadFromXml(xml);
        require(!result.ok, "Malformed XML should fail.");
        require(result.error.find("XML parse error") != std::string::npos,
                "Unexpected malformed-XML error.");
    }
}

void testCodecEncodeDecode() {
    const Packager slm = loadPackagerByName("SLM");
    const std::map<int, std::string> sampleFields = fieldsFromJson(sampleFieldsJson());

    DecodeOptions decodeOptions;
    decodeOptions.header.enabled = true;
    decodeOptions.header.format = LengthFormat::AsciiDigits;
    decodeOptions.header.size = 4;

    const QByteArray sampleRawUtf8 = sampleRawText().toUtf8();
    const std::vector<unsigned char> sampleBytes(sampleRawUtf8.begin(), sampleRawUtf8.end());
    const DecodeResult sampleDecoded = Iso8583Codec::decode(sampleBytes, slm, decodeOptions);
    require(sampleDecoded.ok, "Codec failed to decode the sample buffer: " + sampleDecoded.error);
    require(sampleDecoded.fields.at(0) == "0200", "Sample MTI mismatch after decode.");
    require(sampleDecoded.fields.at(2) == "5892101038910408", "Sample field 2 mismatch after decode.");
    require(sampleDecoded.fields.at(52) == "A5AFB1F93E59A8F3", "Sample field 52 mismatch after decode.");
    require(sampleDecoded.fields.at(128) == "75F69359DFBAE8D4", "Sample field 128 mismatch after decode.");

    EncodeOptions encodeOptions;
    encodeOptions.header.enabled = true;
    encodeOptions.header.format = LengthFormat::AsciiDigits;
    encodeOptions.header.size = 4;

    const EncodeResult encoded = Iso8583Codec::encode(sampleFields, slm, encodeOptions);
    require(encoded.ok, "Codec encode failed: " + encoded.error);

    const DecodeResult decoded = Iso8583Codec::decode(encoded.bytes, slm, decodeOptions);
    require(decoded.ok, "Codec decode failed: " + decoded.error);
    require(decoded.headerDetected, "Expected length header to be detected.");
    require(decoded.headerSize == 4, "Header size mismatch.");
    require(decoded.fields.size() == sampleFields.size(), "Round-trip field count mismatch.");
    for (const auto& entry : sampleFields) {
        const auto it = decoded.fields.find(entry.first);
        require(it != decoded.fields.end(), "Round-trip missing field " + std::to_string(entry.first) + ".");
        const auto defIt = slm.fields.find(entry.first);
        require(defIt != slm.fields.end(), "Missing packager definition for field " + std::to_string(entry.first) + ".");
        const std::string expected = canonicalFieldValue(defIt->second, entry.second);
        require(it->second == expected,
                "Round-trip value mismatch for field " + std::to_string(entry.first) + ".");
    }
}

void testCodecFailureCases() {
    const Packager slm = loadPackagerByName("SLM");

    DecodeOptions decodeOptions;
    decodeOptions.header.enabled = true;
    decodeOptions.header.format = LengthFormat::AsciiDigits;
    decodeOptions.header.size = 4;

    const std::vector<unsigned char> truncated = {'0', '0', '1', '0', '0', '2', '0', '0'};
    const DecodeResult decode = Iso8583Codec::decode(truncated, slm, decodeOptions);
    require(!decode.ok, "Truncated buffer should fail decode.");
    require(decode.error.find("Length header") != std::string::npos, "Decode error should mention length header.");
    require(decode.error.find("offset 0") != std::string::npos, "Decode error should include offset.");
    require(decode.error.find("remaining 8 bytes") != std::string::npos, "Decode error should include remaining bytes.");
    require(decode.error.find("context 3030313030323030") != std::string::npos,
            "Decode error should include context snippet.");

    std::map<int, std::string> missingMti;
    const EncodeResult encodeMissingMti = Iso8583Codec::encode(missingMti, slm, EncodeOptions{});
    require(!encodeMissingMti.ok, "Missing MTI should fail encode.");
    require(encodeMissingMti.error.find("Input error: Field 0 (MTI) is required.") != std::string::npos,
            "Unexpected missing-MTI error.");

    std::map<int, std::string> badBinary = {
        {0, "0200"},
        {52, "AABB"}
    };
    const EncodeResult encodeBinary = Iso8583Codec::encode(badBinary, slm, EncodeOptions{});
    require(!encodeBinary.ok, "Short binary field should fail without padding.");
    require(encodeBinary.error.find("Input error: Field 52 binary length mismatch") != std::string::npos,
            "Unexpected binary-length error.");

    std::map<int, std::string> badNumeric = {
        {0, "0200"},
        {3, "40A000"}
    };
    const EncodeResult encodeNumeric = Iso8583Codec::encode(badNumeric, slm, EncodeOptions{});
    require(!encodeNumeric.ok, "Non-digit numeric field should fail without sanitize.");
    require(encodeNumeric.error.find("Input error: Field 3 expects numeric value.") != std::string::npos,
            "Unexpected numeric-validation error.");

    Packager brokenPackager;
    brokenPackager.name = "Broken";
    brokenPackager.fieldCount = 64;
    brokenPackager.fields[0] = FieldDef{0, FieldType::NumericFixed, 4, "MTI", "", 0, false};
    std::map<int, std::string> missingDefinition = {
        {0, "0200"},
        {2, "ABC"}
    };
    const EncodeResult encodeMissingDefinition = Iso8583Codec::encode(missingDefinition, brokenPackager, EncodeOptions{});
    require(!encodeMissingDefinition.ok, "Missing field definition should fail encode.");
    require(encodeMissingDefinition.error.find("Packager definition error: Missing definition for field 2.") !=
                std::string::npos,
            "Unexpected packager-definition error.");
}

void testNumericSanitize() {
    Packager packager;
    packager.name = "Numeric";
    packager.fieldCount = 64;
    packager.fields[0] = FieldDef{0, FieldType::NumericFixed, 4, "MTI", "", 0, false};
    packager.fields[2] = FieldDef{2, FieldType::NumericFixed, 6, "Numeric fixed", "", 0, false};

    std::map<int, std::string> fields = {
        {0, "0800"},
        {2, "12A3-4"}
    };

    EncodeOptions strictOptions;
    const EncodeResult strictEncoded = Iso8583Codec::encode(fields, packager, strictOptions);
    require(!strictEncoded.ok, "Strict numeric encode should fail.");
    require(strictEncoded.error.find("Input error: Field 2 expects numeric value.") != std::string::npos,
            "Unexpected strict numeric error.");

    EncodeOptions sanitizeOptions;
    sanitizeOptions.allowNumericSanitize = true;
    const EncodeResult sanitized = Iso8583Codec::encode(fields, packager, sanitizeOptions);
    require(sanitized.ok, "Sanitized numeric encode failed: " + sanitized.error);

    const DecodeResult decoded = Iso8583Codec::decode(sanitized.bytes, packager, DecodeOptions{});
    require(decoded.ok, "Sanitized numeric decode failed: " + decoded.error);
    require(decoded.fields.at(2) == "001234", "Sanitized fixed numeric value mismatch.");
}

void testExtendedVariableTypes() {
    Packager packager;
    packager.name = "Extended";
    packager.fieldCount = 64;
    packager.fields[0] = FieldDef{0, FieldType::NumericFixed, 4, "MTI", "", 0, false};
    packager.fields[2] = FieldDef{2, FieldType::LlllChar, 9999, "LLLL char", "", 4, true};
    packager.fields[3] = FieldDef{3, FieldType::BinaryLlll, 9999, "LLLL binary", "", 4, true};
    packager.fields[4] = FieldDef{4, FieldType::LlllllChar, 999999, "LLLLLL char", "", 6, true};

    std::map<int, std::string> fields = {
        {0, "0800"},
        {2, "ABCDE"},
        {3, "0A0B0C0D"},
        {4, "XYZ"}
    };

    const EncodeResult encoded = Iso8583Codec::encode(fields, packager, EncodeOptions{});
    require(encoded.ok, "Extended-type encode failed: " + encoded.error);

    const std::string wire(encoded.bytes.begin(), encoded.bytes.end());
    require(wire.find("0005ABCDE") != std::string::npos, "Missing 4-digit char length prefix.");
    require(wire.find("00040A0B0C0D") != std::string::npos, "Missing 4-digit binary length prefix.");
    require(wire.find("000003XYZ") != std::string::npos, "Missing 6-digit char length prefix.");

    const DecodeResult decoded = Iso8583Codec::decode(encoded.bytes, packager, DecodeOptions{});
    require(decoded.ok, "Extended-type decode failed: " + decoded.error);
    require(decoded.fields.at(2) == "ABCDE", "Decoded LLLLCHAR mismatch.");
    require(decoded.fields.at(3) == "0A0B0C0D", "Decoded LLLLBINARY mismatch.");
    require(decoded.fields.at(4) == "XYZ", "Decoded LLLLLLCHAR mismatch.");
}

void testSequentialPackagerLayouts() {
    {
        const Packager dataset = loadPackagerByName("DATASET");
        std::map<int, std::string> fields = {
            {0, "AB"},
            {1, "Tehran"}
        };

        const EncodeResult encoded = Iso8583Codec::encode(fields, dataset, EncodeOptions{});
        require(encoded.ok, "DATASET encode failed: " + encoded.error);
        const std::string wire(encoded.bytes.begin(), encoded.bytes.end());
        require(wire == "AB0006Tehran", "Unexpected DATASET wire layout.");

        const DecodeResult decoded = Iso8583Codec::decode(encoded.bytes, dataset, DecodeOptions{});
        require(decoded.ok, "DATASET decode failed: " + decoded.error);
        require(decoded.fields.at(0) == "AB", "DATASET field 0 mismatch.");
        require(decoded.fields.at(1) == "Tehran", "DATASET field 1 mismatch.");
    }

    {
        const Packager table62 = loadPackagerByName("TABLE62");
        std::map<int, std::string> fields = {
            {1, "01"},
            {2, "SECURITY"},
            {3, "ABC"},
            {4, "PAN01"},
            {5, "PAN02"}
        };

        const EncodeResult encoded = Iso8583Codec::encode(fields, table62, EncodeOptions{});
        require(encoded.ok, "TABLE62 encode failed: " + encoded.error);

        const DecodeResult decoded = Iso8583Codec::decode(encoded.bytes, table62, DecodeOptions{});
        require(decoded.ok, "TABLE62 decode failed: " + decoded.error);
        require(decoded.fields.at(1) == "01", "TABLE62 field 1 mismatch.");
        require(decoded.fields.at(2) == "SECURITY", "TABLE62 field 2 mismatch.");
        require(decoded.fields.at(3) == "ABC", "TABLE62 field 3 mismatch.");
        require(decoded.fields.at(4) == "PAN01", "TABLE62 field 4 mismatch.");
        require(decoded.fields.at(5) == "PAN02", "TABLE62 field 5 mismatch.");
    }
}

void testSequentialPackagerFailures() {
    const Packager dataset = loadPackagerByName("DATASET");
    std::map<int, std::string> fields = {
        {1, "Tehran"}
    };

    const EncodeResult encoded = Iso8583Codec::encode(fields, dataset, EncodeOptions{});
    require(!encoded.ok, "Sequential layout should reject missing leading fields.");
    require(encoded.error.find("Input error: Sequential field layout requires field 0.") != std::string::npos,
            "Unexpected sequential-layout gap error.");
}

void testBitmapOnlyPackagerLayouts() {
    const Packager table71 = loadPackagerByName("TABLE71");
    std::map<int, std::string> fields = {
        {2, "ACME"},
        {4, "TEHRAN"},
        {5, "THR"}
    };

    const EncodeResult encoded = Iso8583Codec::encode(fields, table71, EncodeOptions{});
    require(encoded.ok, "TABLE71 encode failed: " + encoded.error);

    const std::string wire(encoded.bytes.begin(), encoded.bytes.end());
    require(wire.rfind("580000", 0) == 0, "Unexpected TABLE71 bitmap encoding.");

    const DecodeResult decoded = Iso8583Codec::decode(encoded.bytes, table71, DecodeOptions{});
    require(decoded.ok, "TABLE71 decode failed: " + decoded.error);
    require(decoded.fields.at(0) == "580000", "TABLE71 bitmap field mismatch.");
    require(decoded.fields.at(2) == "ACME", "TABLE71 field 2 mismatch.");
    require(decoded.fields.at(4) == "TEHRAN", "TABLE71 field 4 mismatch.");
    require(decoded.fields.at(5) == "THR", "TABLE71 field 5 mismatch.");
}

void testMacHandling() {
    const std::vector<unsigned char> payload = {
        '1', '2', '3', '4', '5', '6', '7', '8',
        '9', '0', 'A', 'B', 'C', 'D', 'E', 'F'
    };

    const MacResult mac = MacEngine::calculateAnsiX919(payload,
                                                       "0123456789ABCDEFFEDCBA9876543210",
                                                       MacPaddingMode::Iso9797Method1,
                                                       8);
    require(mac.ok, "MAC calculation failed: " + mac.error);
    const std::string macHex = toHex(mac.macBytes, true);
    require(macHex == "205FCEC8BADE9527", "Unexpected MAC output: " + macHex);
}

void testCryptoHandling() {
    const std::vector<unsigned char> input = {
        'T', 'E', 'S', 'T', 'D', 'A', 'T', 'A'
    };

    const CryptoResult encrypted = CryptoEngine::transform("des-ecb",
                                                           true,
                                                           input,
                                                           "0123456789ABCDEF",
                                                           "",
                                                           false);
    require(encrypted.ok, "DES encrypt failed: " + encrypted.error);

    const CryptoResult decrypted = CryptoEngine::transform("des-ecb",
                                                           false,
                                                           encrypted.bytes,
                                                           "0123456789ABCDEF",
                                                           "",
                                                           false);
    require(decrypted.ok, "DES decrypt failed: " + decrypted.error);
    require(decrypted.bytes == input, "DES round-trip mismatch.");
}

void testBackendEncodeDecodeBridge() {
    Backend backend;
    const QJsonObject load = requireOk(backend.loadPackagerFile(sourcePath(QStringLiteral("data/packagers.xml"))));
    require(load.value("packagers").toArray().size() == 32, "Backend packager list size mismatch.");

    const QJsonObject fieldsMeta = requireOk(backend.packagerFieldsJson(QStringLiteral("SLM")));
    require(fieldsMeta.value("lenLen").toInt() == 4, "Backend lenLen mismatch.");
    require(fieldsMeta.value("macMethod").toString() == "FULL", "Backend macMethod mismatch.");
    require(fieldsMeta.value("macSize").toInt() == 16, "Backend macSize mismatch.");
    require(fieldsMeta.value("macConfigured").toBool(false), "Backend should mark MAC as configured.");
    require(fieldsMeta.value("macSupported").toBool(false), "Backend should mark MAC as supported.");
    require(fieldsMeta.value("macFieldIds").toArray().size() == 3, "Backend MAC field list mismatch.");

    const QJsonObject encoded = requireOk(backend.encodeBuffer(QStringLiteral("SLM"),
                                                               sampleFieldsString(),
                                                               false,
                                                               false,
                                                               false,
                                                               true,
                                                               QStringLiteral("ascii"),
                                                               4));
    require(!encoded.value("raw").toString().isEmpty(), "Backend encoded raw payload should not be empty.");

    const QJsonObject decoded = requireOk(backend.decodeBuffer(QStringLiteral("SLM"),
                                                               encoded.value("raw").toString(),
                                                               false,
                                                               true,
                                                               QStringLiteral("ascii"),
                                                               4));
    const QJsonArray fields = decoded.value("fields").toArray();
    require(!fields.isEmpty(), "Backend decode returned no fields.");
    require(decoded.value("headerDetected").toBool(), "Backend should report detected header.");
    require(fields.size() == sampleFieldsJson().size(), "Backend round-trip field count mismatch.");

    const QJsonObject datasetEncoded = requireOk(backend.encodeBuffer(QStringLiteral("DATASET"),
                                                                      QStringLiteral(R"([{"id":0,"value":"AB"},{"id":1,"value":"Tehran"}])"),
                                                                      false,
                                                                      false,
                                                                      false,
                                                                      false,
                                                                      QStringLiteral("ascii"),
                                                                      0));
    require(datasetEncoded.value("raw").toString() == "AB0006Tehran",
            "Backend DATASET encoded raw payload mismatch.");

    const QJsonObject datasetDecoded = requireOk(backend.decodeBuffer(QStringLiteral("DATASET"),
                                                                      QStringLiteral("AB0006Tehran"),
                                                                      false,
                                                                      false,
                                                                      QStringLiteral("ascii"),
                                                                      0));
    require(datasetDecoded.value("fields").toArray().size() == 2, "Backend DATASET decode field count mismatch.");

    const QJsonObject table71Encoded = requireOk(backend.encodeBuffer(QStringLiteral("TABLE71"),
                                                                      QStringLiteral(R"([{"id":2,"value":"ACME"},{"id":4,"value":"TEHRAN"},{"id":5,"value":"THR"}])"),
                                                                      false,
                                                                      false,
                                                                      false,
                                                                      false,
                                                                      QStringLiteral("ascii"),
                                                                      0));
    require(table71Encoded.value("raw").toString().startsWith("580000"),
            "Backend TABLE71 encoded raw payload mismatch.");

    const QJsonObject table71Decoded = requireOk(backend.decodeBuffer(QStringLiteral("TABLE71"),
                                                                      table71Encoded.value("raw").toString(),
                                                                      false,
                                                                      false,
                                                                      QStringLiteral("ascii"),
                                                                      0));
    require(table71Decoded.value("fields").toArray().size() == 4, "Backend TABLE71 decode field count mismatch.");

    const QString macFieldsJson =
        QStringLiteral(R"([{"id":0,"value":"0200"},{"id":3,"value":"400000"},{"id":4,"value":"000000000001"},{"id":11,"value":"000127"},{"id":41,"value":"10201364"},{"id":64,"value":"CB4B93E8E1B8114D"}])");
    const QJsonObject macCalc = requireOk(backend.calculateMacForFields(QStringLiteral("SLM"),
                                                                        macFieldsJson,
                                                                        64,
                                                                        QStringLiteral("0123456789ABCDEFFEDCBA9876543210"),
                                                                        false,
                                                                        QStringLiteral("ascii"),
                                                                        0,
                                                                        QStringLiteral("m1")));
    require(macCalc.value("macHex").toString().size() == 16, "Backend MAC hex size mismatch.");
    require(macCalc.value("payloadHex").toString().size() > 0, "Backend MAC payload should not be empty.");

    const QString verifyFieldsJson =
        QStringLiteral(R"([{"id":0,"value":"0200"},{"id":3,"value":"400000"},{"id":4,"value":"000000000001"},{"id":11,"value":"000127"},{"id":41,"value":"10201364"},{"id":64,"value":"%1"}])")
            .arg(macCalc.value("macHex").toString());
    const QJsonObject macVerify = requireOk(backend.verifyMacForFields(QStringLiteral("SLM"),
                                                                       verifyFieldsJson,
                                                                       64,
                                                                       QStringLiteral("0123456789ABCDEFFEDCBA9876543210"),
                                                                       false,
                                                                       QStringLiteral("ascii"),
                                                                       0,
                                                                       QStringLiteral("m1")));
    require(macVerify.value("match").toBool(false), "Backend MAC verify should match.");

    const QJsonObject cryptoEncrypted = requireOk(backend.transformCrypto(QStringLiteral("des-ecb"),
                                                                          QStringLiteral("encrypt"),
                                                                          QStringLiteral("TESTDATA"),
                                                                          false,
                                                                          QStringLiteral("0123456789ABCDEF"),
                                                                          QStringLiteral(""),
                                                                          false));
    require(cryptoEncrypted.value("rawHex").toString().size() == 16, "Backend crypto hex size mismatch.");

    const QJsonObject cryptoDecrypted = requireOk(backend.transformCrypto(QStringLiteral("des-ecb"),
                                                                          QStringLiteral("decrypt"),
                                                                          cryptoEncrypted.value("rawHex").toString(),
                                                                          true,
                                                                          QStringLiteral("0123456789ABCDEF"),
                                                                          QStringLiteral(""),
                                                                          false));
    require(cryptoDecrypted.value("text").toString() == "TESTDATA", "Backend crypto round-trip mismatch.");

    const QString salaam = QString::fromUtf8(u8"سلام");
    const QJsonObject iranTextEncoded = requireOk(backend.utf8ToIranSystemText(salaam, true));
    require(iranTextEncoded.value("text").toString().size() > 0, "Backend IranSystem text should not be empty.");

    const QJsonObject iranTextDecoded = requireOk(backend.iranSystemTextToUtf8(iranTextEncoded.value("text").toString()));
    require(iranTextDecoded.value("text").toString() == salaam, "Backend IranSystem text round-trip mismatch.");

    const QJsonObject asciiEncoded = requireOk(backend.utf8ToAsciiText(QStringLiteral("ABC123")));
    require(asciiEncoded.value("text").toString() == QStringLiteral("ABC123"), "Backend ASCII encode mismatch.");

    const QJsonObject asciiDecoded = requireOk(backend.asciiToUtf8Text(QStringLiteral("ATM-01")));
    require(asciiDecoded.value("text").toString() == QStringLiteral("ATM-01"), "Backend ASCII decode mismatch.");

    const QJsonObject asciiRejected = parseJsonObject(backend.utf8ToAsciiText(QString::fromUtf8(u8"س")));
    require(!asciiRejected.value("ok").toBool(true), "Backend ASCII conversion should reject non-ASCII input.");

    const QJsonObject ansiEncoded = requireOk(backend.utf8ToAnsiText(QStringLiteral("ATM-01")));
    require(ansiEncoded.value("text").toString() == QStringLiteral("ATM-01"), "Backend ANSI encode mismatch.");

    const QJsonObject ansiDecoded = requireOk(backend.ansiToUtf8Text(QStringLiteral("ATM-01")));
    require(ansiDecoded.value("text").toString() == QStringLiteral("ATM-01"), "Backend ANSI decode mismatch.");

#ifdef _WIN32
    if (GetACP() == 1256) {
        const QString phrase = QString::fromUtf8(u8"سلام چطوری");
        const QJsonObject ansiPhraseEncoded = requireOk(backend.utf8ToAnsiText(phrase));
        const QJsonObject ansiPhraseDecoded = requireOk(backend.ansiToUtf8Text(ansiPhraseEncoded.value("text").toString()));
        require(ansiPhraseDecoded.value("text").toString() == phrase, "Backend ANSI Persian round-trip mismatch.");
    }
#endif
}

void testBackendSaveLoad() {
    Backend backend;
    requireOk(backend.loadPackagerFile(sourcePath(QStringLiteral("data/packagers.xml"))));

    QTemporaryDir tempDir;
    require(tempDir.isValid(), "Failed to create temporary directory.");

    const QString path = tempDir.path() + QStringLiteral("/sample-buffer.json");
    const QString fieldsJson = sampleFieldsString();

    requireOk(backend.saveBufferFile(path,
                                     QStringLiteral("SLM"),
                                     fieldsJson,
                                     sampleRawText(),
                                     false,
                                     true,
                                     true,
                                     QStringLiteral("ascii"),
                                     4));

    const QJsonObject loaded = requireOk(backend.loadBufferFile(path));
    const QJsonObject buffer = loaded.value("buffer").toObject();
    require(buffer.value("packager").toString() == "SLM", "Saved packager mismatch.");
    require(buffer.value("raw").toString() == sampleRawText(), "Saved raw payload mismatch.");

    const QJsonObject header = buffer.value("lengthHeader").toObject();
    require(header.value("enabled").toBool(), "Saved header.enabled mismatch.");
    require(header.value("auto").toBool(), "Saved header.auto mismatch.");
    require(header.value("mode").toString() == "ascii", "Saved header.mode mismatch.");
    require(header.value("size").toInt() == 4, "Saved header.size mismatch.");

    const QJsonArray fields = buffer.value("fields").toArray();
    require(fields.size() == sampleFieldsJson().size(), "Saved field count mismatch.");
}

void testTlvParsing() {
    const std::string hex =
        "711A6B0D8107312E302E302E30830230326F04890230306203810131";
    const HexParseResult parsed = fromHex(hex);
    require(parsed.ok, "TLV sample hex parse failed.");

    const std::vector<tlvtool::Node> nodes =
        tlvtool::parse(std::vector<uint8_t>(parsed.bytes.begin(), parsed.bytes.end()));
    require(nodes.size() == 1, "Expected one TLV root node.");
    require(tlvtool::toHex(nodes.front().tag, 0) == "71", "Unexpected TLV root tag.");
    require(nodes.front().isComposite(), "Root TLV node should be composite.");
    require(nodes.front().children.size() == 3, "Root TLV child count mismatch.");

    const std::string treeText = tlvtool::buildTreeText(nodes);
    require(treeText.find("Tag=71") != std::string::npos, "TLV tree output missing root tag.");

    const std::string inlineText = tlvtool::buildInlineText(nodes);
    require(inlineText.find("71/6B/81") != std::string::npos, "TLV inline output missing expected path.");
    require(inlineText.find("Terminal firmware version") != std::string::npos,
            "TLV inline output missing tag description.");

    Backend backend;
    const QJsonObject parsedTlv = requireOk(backend.parseTlv(QString::fromStdString(hex), true));
    require(parsedTlv.value("treeText").toString().contains("Tag=71"), "Backend TLV tree text mismatch.");
    require(parsedTlv.value("inlineText").toString().contains("71/6B/81"),
            "Backend TLV inline text mismatch.");

    const QJsonArray flat = parsedTlv.value("flat").toArray();
    require(flat.size() == 4, "Backend TLV flat entry count mismatch.");
    require(flat.at(0).toObject().value("description").toString().contains("Terminal firmware version"),
            "Backend TLV description mismatch.");
}

void runTest(const char* name, const std::function<void()>& test) {
    test();
    std::cout << "[PASS] " << name << '\n';
}

} // namespace

int main(int argc, char* argv[]) {
    QCoreApplication app(argc, argv);

    try {
        runTest("Hex round trip", testHexRoundTrip);
        runTest("Hex failures", testHexFailures);
        runTest("Field type mapping", testFieldTypeMapping);
        runTest("Packager loader", testPackagerLoader);
        runTest("Packager loader failures", testPackagerLoaderFailures);
        runTest("Codec encode/decode", testCodecEncodeDecode);
        runTest("Codec failure cases", testCodecFailureCases);
        runTest("Numeric sanitize", testNumericSanitize);
        runTest("Extended variable types", testExtendedVariableTypes);
        runTest("Sequential packager layouts", testSequentialPackagerLayouts);
        runTest("Sequential packager failures", testSequentialPackagerFailures);
        runTest("Bitmap-only packager layouts", testBitmapOnlyPackagerLayouts);
        runTest("MAC handling", testMacHandling);
        runTest("Crypto handling", testCryptoHandling);
        runTest("Backend encode/decode bridge", testBackendEncodeDecodeBridge);
        runTest("Backend save/load", testBackendSaveLoad);
        runTest("TLV parsing", testTlvParsing);
    } catch (const TestFailure& failure) {
        std::cerr << "[FAIL] " << failure.what() << '\n';
        return EXIT_FAILURE;
    } catch (const std::exception& failure) {
        std::cerr << "[FAIL] Unexpected exception: " << failure.what() << '\n';
        return EXIT_FAILURE;
    } catch (...) {
        std::cerr << "[FAIL] Unknown exception.\n";
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}
