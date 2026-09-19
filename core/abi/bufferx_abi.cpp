// The BufferX C ABI: request dispatcher and per-op handlers.
//
// The shape of this file is deliberate. Every operation is a small function
// with the signature `json::Value(bufferx_session&, const json::Value& args)`
// that either returns the `data` object or throws an `AbiError`. It never
// formats an envelope itself and never touches the C boundary. One dispatcher
// owns envelope parsing, op lookup, and the try/catch that guarantees no
// exception escapes into C. That separation is what makes it possible to state,
// and keep, the promise in the header: `bufferx_invoke` always returns a valid
// envelope.
//
// Argument reading goes through the helpers in the "arguments" section rather
// than being open-coded per handler. Repeating validation forty times is how a
// banking tool ends up with one op that silently defaults a key length while
// its neighbour rejects it.
//
// Secrecy: no handler puts an argument value into an error message. Errors name
// the argument and describe the rule it broke. `detail.arg` carries the
// argument *name*, never its contents.

#include "bufferx_abi.h"

#include "DefaultPackagers.h"
#include "JsonLite.h"

#include "bufferx/BufferXCore.h"
#include "bufferx/TextCodec.h"
#include "bufferx/XmlLite.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <map>
#include <new>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

// Defined at global scope so the tag matches the `struct bufferx_session`
// forward declaration in the C header. The registry lives here rather than in a
// global precisely so two hosts -- two windows, two tabs -- cannot disturb each
// other's packager set.
struct bufferx_session {
    std::vector<Packager> packagers;
};

namespace {

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

enum class ErrorCode {
    BadHex,
    BadLength,
    BadArgument,
    UnknownPackager,
    UnknownOp,
    DecodeFailed,
    EncodeFailed,
    CryptoFailed,
    ParseFailed,
    Unsupported,
    HostOnly,
    Timeout,
    Internal
};

const char* errorCodeName(ErrorCode code) {
    switch (code) {
        case ErrorCode::BadHex:          return "BAD_HEX";
        case ErrorCode::BadLength:       return "BAD_LENGTH";
        case ErrorCode::BadArgument:     return "BAD_ARGUMENT";
        case ErrorCode::UnknownPackager: return "UNKNOWN_PACKAGER";
        case ErrorCode::UnknownOp:       return "UNKNOWN_OP";
        case ErrorCode::DecodeFailed:    return "DECODE_FAILED";
        case ErrorCode::EncodeFailed:    return "ENCODE_FAILED";
        case ErrorCode::CryptoFailed:    return "CRYPTO_FAILED";
        case ErrorCode::ParseFailed:     return "PARSE_FAILED";
        case ErrorCode::Unsupported:     return "UNSUPPORTED";
        case ErrorCode::HostOnly:        return "HOST_ONLY";
        case ErrorCode::Timeout:         return "TIMEOUT";
        case ErrorCode::Internal:        return "INTERNAL";
    }
    return "INTERNAL";
}

// Carries a classified failure from a handler up to the dispatcher. Derived
// from std::exception so that a handler which forgets to catch a core exception
// still lands somewhere sane.
class AbiError final : public std::exception {
public:
    AbiError(ErrorCode code, std::string message)
        : code_(code), message_(std::move(message)), detail_(json::Value::object()) {}

    void addDetail(std::string key, json::Value value) {
        detail_.set(std::move(key), std::move(value));
        hasDetail_ = true;
    }

    ErrorCode code() const noexcept { return code_; }
    const std::string& message() const noexcept { return message_; }
    const json::Value& detail() const noexcept { return detail_; }
    bool hasDetail() const noexcept { return hasDetail_; }

    const char* what() const noexcept override { return message_.c_str(); }

private:
    ErrorCode   code_;
    std::string message_;
    json::Value detail_;
    bool        hasDetail_ = false;
};

[[noreturn]] void fail(ErrorCode code, std::string message) {
    throw AbiError(code, std::move(message));
}

// The overwhelmingly common failure: an argument is absent, mistyped, or
// violates a rule. `arg` names it so the UI can highlight the right control.
[[noreturn]] void failArg(ErrorCode code, const std::string& arg, std::string message) {
    AbiError error(code, std::move(message));
    error.addDetail("arg", json::Value(arg));
    throw error;
}

[[noreturn]] void badArgument(const std::string& arg, std::string message) {
    failArg(ErrorCode::BadArgument, arg, std::move(message));
}

// ---------------------------------------------------------------------------
// Small text utilities
// ---------------------------------------------------------------------------

std::string toLowerAscii(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

// Lowercases and drops every non-alphanumeric character, so "ISO-0", "iso 0"
// and "iso0" are the same selector. Used only for enum-ish arguments where the
// set of legal values is closed and listed in the error message; never used to
// paper over a value the core would reject.
std::string normalizeSelector(const std::string& value) {
    std::string normalized;
    normalized.reserve(value.size());
    for (unsigned char ch : value) {
        if (std::isalnum(ch) != 0) {
            normalized.push_back(static_cast<char>(std::tolower(ch)));
        }
    }
    return normalized;
}

bool equalsIgnoreCase(const std::string& left, const std::string& right) {
    return toLowerAscii(left) == toLowerAscii(right);
}

std::string trimmed(const std::string& value) {
    std::size_t begin = 0;
    std::size_t end = value.size();
    while (begin < end && std::isspace(static_cast<unsigned char>(value[begin])) != 0) {
        ++begin;
    }
    while (end > begin && std::isspace(static_cast<unsigned char>(value[end - 1])) != 0) {
        --end;
    }
    return value.substr(begin, end - begin);
}

std::string toUpperAscii(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::toupper(ch));
    });
    return value;
}

std::vector<unsigned char> stringBytes(const std::string& text) {
    return std::vector<unsigned char>(text.begin(), text.end());
}

std::string bytesString(const std::vector<unsigned char>& bytes) {
    return std::string(bytes.begin(), bytes.end());
}

// Renders raw bytes as text by mapping each byte to U+0000..U+00FF. A byte
// sequence that is not valid UTF-8 -- a Windows-1256 string, say -- cannot ride
// inside a JSON string as itself, so the ANSI ops use this reversible
// representation. `latin1ToBytes` is its exact inverse.
std::string bytesToLatin1(const std::vector<unsigned char>& bytes) {
    std::string out;
    out.reserve(bytes.size());
    for (unsigned char byte : bytes) {
        if (byte < 0x80) {
            out.push_back(static_cast<char>(byte));
        } else {
            out.push_back(static_cast<char>(0xC0 | (byte >> 6)));
            out.push_back(static_cast<char>(0x80 | (byte & 0x3F)));
        }
    }
    return out;
}

std::vector<unsigned char> latin1ToBytes(const std::string& text, const std::string& arg) {
    const std::u32string codepoints = textcodec::utf8ToUtf32(text);
    std::vector<unsigned char> bytes;
    bytes.reserve(codepoints.size());
    for (char32_t codepoint : codepoints) {
        if (codepoint > 0xFF) {
            badArgument(arg,
                        "Argument '" + arg +
                            "' must be a byte string (every character below U+0100). Use the "
                            "hex variant of this operation for arbitrary bytes.");
        }
        bytes.push_back(static_cast<unsigned char>(codepoint));
    }
    return bytes;
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const json::Value* member(const json::Value& args, const char* key) {
    return args.find(key);
}

std::string requiredString(const json::Value& args, const char* key) {
    const json::Value* value = member(args, key);
    if (value == nullptr || value->isNull()) {
        badArgument(key, std::string("Argument '") + key + "' is required.");
    }
    if (!value->isString()) {
        badArgument(key, std::string("Argument '") + key + "' must be a string.");
    }
    return value->asString();
}

std::string requiredNonEmptyString(const json::Value& args, const char* key) {
    std::string text = requiredString(args, key);
    if (trimmed(text).empty()) {
        badArgument(key, std::string("Argument '") + key + "' must not be empty.");
    }
    return text;
}

std::string optionalString(const json::Value& args, const char* key, const std::string& fallback = {}) {
    const json::Value* value = member(args, key);
    if (value == nullptr || value->isNull()) {
        return fallback;
    }
    if (!value->isString()) {
        badArgument(key, std::string("Argument '") + key + "' must be a string.");
    }
    return value->asString();
}

bool optionalBool(const json::Value& args, const char* key, bool fallback) {
    const json::Value* value = member(args, key);
    if (value == nullptr || value->isNull()) {
        return fallback;
    }
    if (!value->isBool()) {
        badArgument(key, std::string("Argument '") + key + "' must be true or false.");
    }
    return value->asBool();
}

int optionalInt(const json::Value& args, const char* key, int fallback) {
    const json::Value* value = member(args, key);
    if (value == nullptr || value->isNull()) {
        return fallback;
    }
    if (!value->isNumber()) {
        badArgument(key, std::string("Argument '") + key + "' must be a number.");
    }
    return value->asInt(fallback);
}

int requiredInt(const json::Value& args, const char* key) {
    const json::Value* value = member(args, key);
    if (value == nullptr || value->isNull()) {
        badArgument(key, std::string("Argument '") + key + "' is required.");
    }
    if (!value->isNumber()) {
        badArgument(key, std::string("Argument '") + key + "' must be a number.");
    }
    return value->asInt();
}

// Parses a hex-text argument. The core's own diagnostic ("Invalid hex
// character." / "Odd number of hex digits.") is preserved verbatim so the two
// pinned messages survive; the argument name arrives separately in `detail`,
// never the offending text -- the argument may be a key.
std::vector<unsigned char> hexBytes(const std::string& text, const std::string& arg) {
    const HexParseResult parsed = fromHex(text);
    if (!parsed.ok) {
        failArg(ErrorCode::BadHex, arg, parsed.error);
    }
    return parsed.bytes;
}

std::vector<unsigned char> requiredHexBytes(const json::Value& args, const char* key) {
    return hexBytes(requiredString(args, key), key);
}

std::vector<unsigned char> optionalHexBytes(const json::Value& args, const char* key) {
    const std::string text = optionalString(args, key);
    if (text.empty()) {
        return {};
    }
    return hexBytes(text, key);
}

// The `payload` + `inputHex` pair that appears on every op taking a byte
// buffer. `inputHex` defaults to true because every payload this tool handles
// is normally pasted as hex; a caller that means raw text says so explicitly.
std::vector<unsigned char> payloadBytes(const json::Value& args,
                                        const char* payloadKey = "payload",
                                        const char* hexKey = "inputHex") {
    const std::string payload = requiredString(args, payloadKey);
    if (!optionalBool(args, hexKey, true)) {
        return stringBytes(payload);
    }
    return hexBytes(payload, payloadKey);
}

// ---------------------------------------------------------------------------
// Shared domain helpers
// ---------------------------------------------------------------------------

const Packager& resolvePackager(const bufferx_session& session, const json::Value& args) {
    const std::string name = requiredString(args, "packager");
    for (const Packager& packager : session.packagers) {
        if (packager.name == name) {
            return packager;
        }
    }
    AbiError error(ErrorCode::UnknownPackager, "Packager not found: " + name);
    error.addDetail("arg", json::Value("packager"));
    error.addDetail("packager", json::Value(name));
    throw error;
}

std::string lengthFormatName(LengthFormat format) {
    switch (format) {
        case LengthFormat::None:            return "none";
        case LengthFormat::AsciiDigits:     return "ascii";
        case LengthFormat::BinaryBigEndian: return "binary";
    }
    return "none";
}

LengthFormat parseLengthFormat(const std::string& mode) {
    const std::string normalized = normalizeSelector(mode);
    if (normalized == "none" || normalized.empty()) {
        return LengthFormat::None;
    }
    if (normalized == "ascii" || normalized == "asciidigits") {
        return LengthFormat::AsciiDigits;
    }
    if (normalized == "binary" || normalized == "binarybigendian") {
        return LengthFormat::BinaryBigEndian;
    }
    AbiError error(ErrorCode::BadArgument,
                   "Length header mode must be \"none\", \"ascii\", or \"binary\".");
    error.addDetail("arg", json::Value("header.mode"));
    json::Value allowed = json::Value::array();
    allowed.push(json::Value("none"));
    allowed.push(json::Value("ascii"));
    allowed.push(json::Value("binary"));
    error.addDetail("allowed", allowed);
    throw error;
}

// `header` is `{ enabled, mode, size }`. Absent means "no length header", which
// is the common case for a message pasted out of a trace.
LengthHeader readLengthHeader(const json::Value& args) {
    LengthHeader header;
    const json::Value* node = member(args, "header");
    if (node == nullptr || node->isNull()) {
        return header;
    }
    if (!node->isObject()) {
        badArgument("header", "Argument 'header' must be an object of { enabled, mode, size }.");
    }
    header.enabled = optionalBool(*node, "enabled", false);
    header.format = parseLengthFormat(optionalString(*node, "mode", "none"));
    header.size = optionalInt(*node, "size", 0);
    if (header.enabled && header.size <= 0) {
        failArg(ErrorCode::BadLength, "header.size",
                "A length header must declare a positive size.");
    }
    return header;
}

// `fields: [{ id, value }]`. A std::map keeps the codec's ascending-id
// requirement and makes duplicate ids detectable.
std::map<int, std::string> readFieldMap(const json::Value& args) {
    const json::Value* node = member(args, "fields");
    if (node == nullptr || node->isNull()) {
        badArgument("fields", "Argument 'fields' is required.");
    }
    if (!node->isArray()) {
        badArgument("fields", "Argument 'fields' must be an array of { id, value } objects.");
    }

    std::map<int, std::string> fields;
    for (std::size_t index = 0; index < node->size(); ++index) {
        const std::string where = "fields[" + std::to_string(index) + "]";
        const json::Value& entry = node->at(index);
        if (!entry.isObject()) {
            badArgument("fields", where + " must be an object with 'id' and 'value'.");
        }
        const json::Value* id = entry.find("id");
        if (id == nullptr || !id->isNumber()) {
            badArgument("fields", where + ".id must be a number.");
        }
        const json::Value* value = entry.find("value");
        if (value == nullptr || !value->isString()) {
            badArgument("fields", where + ".value must be a string.");
        }
        const int fieldId = id->asInt(-1);
        if (fieldId < 0) {
            badArgument("fields", where + ".id must not be negative.");
        }
        if (!fields.emplace(fieldId, value->asString()).second) {
            badArgument("fields",
                        where + " repeats field id " + std::to_string(fieldId) +
                            "; each field may appear once.");
        }
    }
    return fields;
}

json::Value fieldDefValue(const FieldDef& def) {
    json::Value out = json::Value::object();
    out.set("id", json::Value(def.id));
    out.set("type", json::Value(fieldTypeToString(def.type)));
    out.set("length", json::Value(def.length));
    out.set("desc", json::Value(def.desc));
    out.set("flags", json::Value(def.flags));
    out.set("lengthDigits", json::Value(def.lengthDigits));
    out.set("variable", json::Value(def.variable));
    out.set("sourceType", json::Value(def.sourceType));
    return out;
}

// The legacy rule for which fields can carry a MAC, preserved because the UI
// offers exactly this list in its "MAC field" selector.
bool isMacFieldDescriptor(const FieldDef& def) {
    if (def.id == 64 || def.id == 96 || def.id == 128) {
        return true;
    }
    const std::string description = toUpperAscii(def.desc);
    return description.find("AUTHENTICATION CODE") != std::string::npos ||
           description.find("MAC") != std::string::npos;
}

json::Value packagerSummary(const Packager& packager) {
    json::Value out = json::Value::object();
    out.set("name", json::Value(packager.name));
    out.set("macMethod", json::Value(packager.macMethod));
    out.set("macSize", json::Value(packager.macSize));
    out.set("macConfigured", json::Value(packager.macSize > 0));
    out.set("bitmapIndex", json::Value(packager.bitmapIndex));
    out.set("secondPartBitmap", json::Value(packager.secondPartBitmap));
    out.set("fieldCount", json::Value(packager.fieldCount));
    out.set("lenFormat", json::Value(packager.lenFormat));
    out.set("lenLen", json::Value(packager.lenLen));
    out.set("fieldDefinitionCount", json::Value(static_cast<long long>(packager.fields.size())));

    std::vector<int> macFieldIds;
    if (packager.macSize > 0) {
        for (const auto& entry : packager.fields) {
            if (isMacFieldDescriptor(entry.second)) {
                macFieldIds.push_back(entry.first);
            }
        }
        std::sort(macFieldIds.begin(), macFieldIds.end());
    }
    json::Value ids = json::Value::array();
    for (int id : macFieldIds) {
        ids.push(json::Value(id));
    }
    out.set("macFieldIds", ids);
    return out;
}

// ---------------------------------------------------------------------------
// engine.*
// ---------------------------------------------------------------------------

json::Value opEngineVersion(bufferx_session&, const json::Value&) {
    json::Value data = json::Value::object();
    data.set("version", json::Value(BUFFERX_ABI_VERSION));
    data.set("protocol", json::Value(BUFFERX_ABI_PROTOCOL));
    return data;
}

// The C ABI is pure computation: no sockets, no filesystem, no dialogs. The
// Rust desktop host answers this op itself and reports its own, richer set;
// the WASM build gets these literals, which is the truth in a browser.
json::Value opEngineCapabilities(bufferx_session&, const json::Value&) {
    json::Value data = json::Value::object();
    data.set("tcp", json::Value(false));
    data.set("files", json::Value(false));
    data.set("keyFiles", json::Value(false));
    data.set("desktop", json::Value(false));
    return data;
}

// ---------------------------------------------------------------------------
// packager.*
// ---------------------------------------------------------------------------

json::Value opPackagerLoadXml(bufferx_session& session, const json::Value& args) {
    const std::string xml = requiredNonEmptyString(args, "xml");
    const PackagerLoadResult loaded = PackagerLoader::loadFromXml(xml);
    if (!loaded.ok) {
        failArg(ErrorCode::ParseFailed, "xml", loaded.error);
    }

    // Replaces the registry outright: a partially-updated registry would let a
    // stale definition decode a message the operator believes was decoded with
    // the file they just loaded.
    session.packagers = loaded.packagers;

    json::Value packagers = json::Value::array();
    for (const Packager& packager : session.packagers) {
        packagers.push(packagerSummary(packager));
    }
    json::Value data = json::Value::object();
    data.set("packagers", packagers);
    data.set("count", json::Value(static_cast<long long>(session.packagers.size())));
    return data;
}

json::Value opPackagerList(bufferx_session& session, const json::Value&) {
    json::Value packagers = json::Value::array();
    for (const Packager& packager : session.packagers) {
        packagers.push(packagerSummary(packager));
    }
    json::Value data = json::Value::object();
    data.set("packagers", packagers);
    return data;
}

json::Value opPackagerFields(bufferx_session& session, const json::Value& args) {
    const Packager& packager = resolvePackager(session, args);

    std::vector<int> ids;
    ids.reserve(packager.fields.size());
    for (const auto& entry : packager.fields) {
        ids.push_back(entry.first);
    }
    std::sort(ids.begin(), ids.end());

    json::Value fields = json::Value::array();
    for (int id : ids) {
        fields.push(fieldDefValue(packager.fields.at(id)));
    }
    json::Value data = json::Value::object();
    data.set("fields", fields);
    return data;
}

// ---------------------------------------------------------------------------
// iso.*
// ---------------------------------------------------------------------------

// Renders decoded fields with the packager metadata the UI shows beside them,
// so the frontend never has to join two responses to draw one table.
json::Value renderDecodedFields(const Packager& packager,
                                const std::map<int, std::string>& decodedFields) {
    json::Value fields = json::Value::array();
    for (const auto& entry : decodedFields) {
        json::Value field = json::Value::object();
        field.set("id", json::Value(entry.first));
        field.set("value", json::Value(entry.second));
        field.set("hex", json::Value(toHex(stringBytes(entry.second), true)));

        const auto def = packager.fields.find(entry.first);
        if (def == packager.fields.end()) {
            field.set("desc", json::Value(std::string()));
            field.set("type", json::Value(fieldTypeToString(FieldType::Unknown)));
            field.set("length", json::Value(0));
            field.set("variable", json::Value(false));
        } else {
            field.set("desc", json::Value(def->second.desc));
            field.set("type", json::Value(fieldTypeToString(def->second.type)));
            field.set("length", json::Value(def->second.length));
            field.set("variable", json::Value(def->second.variable));
        }
        fields.push(field);
    }
    return fields;
}

json::Value opIsoDecode(bufferx_session& session, const json::Value& args) {
    const Packager& packager = resolvePackager(session, args);
    const std::vector<unsigned char> payload = payloadBytes(args);

    DecodeOptions options;
    options.header = readLengthHeader(args);
    options.autoDetectHeader = optionalBool(args, "autoDetect", false);
    options.legacyEngine = optionalBool(args, "legacyEngine", false);

    const DecodeResult decoded = Iso8583Codec::decode(payload, packager, options);
    if (!decoded.ok) {
        // The codec fills `fields` as it walks, so everything read before the
        // failure is already here. Returning it matters: a truncated or
        // malformed message is exactly when an operator needs to see how far
        // the parse got and which field it died on. Discarding it turns a
        // diagnosable buffer into a bare error string.
        AbiError error(ErrorCode::DecodeFailed, decoded.error);
        error.addDetail("packager", json::Value(packager.name));
        error.addDetail("partialFields", renderDecodedFields(packager, decoded.fields));
        error.addDetail("partialCount", json::Value(static_cast<long long>(decoded.fields.size())));
        error.addDetail("byteLength", json::Value(static_cast<long long>(payload.size())));
        throw error;
    }

    json::Value fields = renderDecodedFields(packager, decoded.fields);

    json::Value data = json::Value::object();
    data.set("fields", fields);
    data.set("headerDetected", json::Value(decoded.headerDetected));
    data.set("headerFormat", json::Value(lengthFormatName(decoded.headerFormat)));
    data.set("headerSize", json::Value(decoded.headerSize));
    data.set("messageLength", json::Value(static_cast<long long>(decoded.messageLength)));
    data.set("byteLength", json::Value(static_cast<long long>(payload.size())));
    return data;
}

json::Value opIsoEncode(bufferx_session& session, const json::Value& args) {
    const Packager& packager = resolvePackager(session, args);
    const std::map<int, std::string> fields = readFieldMap(args);

    EncodeOptions options;
    options.header = readLengthHeader(args);
    options.allowBinaryPadding = optionalBool(args, "allowBinaryPadding", false);
    options.allowNumericSanitize = optionalBool(args, "allowNumericSanitize", false);
    options.legacyEngine = optionalBool(args, "legacyEngine", false);

    // Accepted for symmetry with iso.decode's `inputHex` and validated so a
    // typo is caught, but the response carries both renderings unconditionally:
    // `hex` is authoritative, `text` is the same bytes read as UTF-8 and is
    // lossy whenever the message is not valid UTF-8.
    (void)optionalBool(args, "outputHex", true);

    const EncodeResult encoded = Iso8583Codec::encode(fields, packager, options);
    if (!encoded.ok) {
        AbiError error(ErrorCode::EncodeFailed, encoded.error);
        error.addDetail("packager", json::Value(packager.name));
        throw error;
    }

    json::Value data = json::Value::object();
    data.set("hex", json::Value(toHex(encoded.bytes, true)));
    data.set("text", json::Value(bytesString(encoded.bytes)));
    data.set("byteLength", json::Value(static_cast<long long>(encoded.bytes.size())));
    return data;
}

// ---------------------------------------------------------------------------
// mac.*
// ---------------------------------------------------------------------------

MacPaddingMode readPaddingMode(const json::Value& args) {
    const std::string raw = requiredString(args, "paddingMode");
    const std::string normalized = normalizeSelector(raw);
    if (normalized == "iso97971") {
        return MacPaddingMode::Iso9797Method1;
    }
    if (normalized == "iso97972") {
        return MacPaddingMode::Iso9797Method2;
    }
    // Deliberately strict. The engine this replaced accepted three spellings of
    // Method 2 and silently fell back to Method 1 for everything else,
    // including the near-miss "ISO9797 M2". MACing with the wrong padding
    // because of a typo is not an acceptable failure mode.
    AbiError error(ErrorCode::BadArgument,
                   "Argument 'paddingMode' must be \"iso9797-1\" or \"iso9797-2\".");
    error.addDetail("arg", json::Value("paddingMode"));
    json::Value allowed = json::Value::array();
    allowed.push(json::Value("iso9797-1"));
    allowed.push(json::Value("iso9797-2"));
    error.addDetail("allowed", allowed);
    throw error;
}

// The MAC key length rule is enforced here rather than left to the core so that
// the message can name the constraint without echoing the key.
std::string readMacKeyHex(const json::Value& args) {
    const std::string keyHex = requiredString(args, "keyHex");
    const std::vector<unsigned char> key = hexBytes(keyHex, "keyHex");
    if (key.size() != 8 && key.size() != 16 && key.size() != 24) {
        failArg(ErrorCode::BadLength, "keyHex",
                "MAC key must be 16, 32, or 48 hex characters (8, 16, or 24 bytes).");
    }
    return keyHex;
}

// Legacy rule, preserved: the packager's MAC field length when it declares one,
// else half the declared MAC size (which is counted in hex characters), else 8.
int macOutputBytes(const Packager& packager, int macFieldId) {
    const auto def = packager.fields.find(macFieldId);
    if (def != packager.fields.end() && def->second.length > 0) {
        return def->second.length;
    }
    if (packager.macSize > 0 && (packager.macSize % 2) == 0) {
        return packager.macSize / 2;
    }
    return 8;
}

// The bytes the MAC is computed over. Normally the encoded message with the MAC
// field removed. Under the legacy engine a packager whose MacMethod is PARTIAL
// instead MACs the raw concatenation of the values of the fields its definition
// flags with a leading '1' -- a host convention that predates this tool and
// that the pinned SHETAB7 vector depends on.
std::vector<unsigned char> buildMacPayload(const Packager& packager,
                                           std::map<int, std::string> fields,
                                           int macFieldId,
                                           const EncodeOptions& options) {
    fields.erase(macFieldId);

    if (options.legacyEngine && equalsIgnoreCase(packager.macMethod, "PARTIAL")) {
        std::vector<unsigned char> payload;
        for (const auto& entry : fields) {
            const auto def = packager.fields.find(entry.first);
            if (def == packager.fields.end()) {
                continue;
            }
            if (def->second.flags.empty() || def->second.flags[0] != '1') {
                continue;
            }
            payload.insert(payload.end(), entry.second.begin(), entry.second.end());
        }
        return payload;
    }

    const EncodeResult encoded = Iso8583Codec::encode(fields, packager, options);
    if (!encoded.ok) {
        AbiError error(ErrorCode::EncodeFailed, encoded.error);
        error.addDetail("packager", json::Value(packager.name));
        throw error;
    }
    return encoded.bytes;
}

struct MacRequest {
    const Packager*            packager = nullptr;
    std::map<int, std::string> fields;
    int                        macFieldId = 0;
    std::string                keyHex;
    MacPaddingMode             padding = MacPaddingMode::Iso9797Method1;
    EncodeOptions              options;
};

MacRequest readMacRequest(bufferx_session& session, const json::Value& args) {
    MacRequest request;
    request.packager = &resolvePackager(session, args);
    request.fields = readFieldMap(args);
    request.macFieldId = requiredInt(args, "macFieldId");
    if (request.macFieldId < 0) {
        badArgument("macFieldId", "MAC field id must not be negative.");
    }
    request.keyHex = readMacKeyHex(args);
    request.padding = readPaddingMode(args);
    request.options.header = readLengthHeader(args);
    request.options.legacyEngine = optionalBool(args, "legacyEngine", false);
    return request;
}

std::string calculateMac(const MacRequest& request) {
    const std::vector<unsigned char> payload =
        buildMacPayload(*request.packager, request.fields, request.macFieldId, request.options);

    const MacResult mac = MacEngine::calculateAnsiX919(payload,
                                                       request.keyHex,
                                                       request.padding,
                                                       macOutputBytes(*request.packager,
                                                                      request.macFieldId));
    if (!mac.ok) {
        fail(ErrorCode::CryptoFailed, mac.error);
    }
    return toHex(mac.macBytes, true);
}

json::Value opMacCalculate(bufferx_session& session, const json::Value& args) {
    const MacRequest request = readMacRequest(session, args);
    json::Value data = json::Value::object();
    data.set("macHex", json::Value(calculateMac(request)));
    return data;
}

json::Value opMacVerify(bufferx_session& session, const json::Value& args) {
    const MacRequest request = readMacRequest(session, args);

    const auto provided = request.fields.find(request.macFieldId);
    if (provided == request.fields.end() || trimmed(provided->second).empty()) {
        badArgument("fields",
                    "Field " + std::to_string(request.macFieldId) +
                        " must carry the received MAC in order to verify it.");
    }
    const std::string actualHex = toUpperAscii(trimmed(provided->second));
    const std::string expectedHex = calculateMac(request);

    // A MAC that does not match is an answer, not a fault: the caller asked
    // whether it matched and the engine is telling them.
    json::Value data = json::Value::object();
    data.set("valid", json::Value(actualHex == expectedHex));
    data.set("expectedHex", json::Value(expectedHex));
    data.set("actualHex", json::Value(actualHex));
    return data;
}

// ---------------------------------------------------------------------------
// crypto.*
// ---------------------------------------------------------------------------

json::Value opCryptoTransform(bufferx_session&, const json::Value& args) {
    const std::string algorithm = requiredNonEmptyString(args, "algorithm");
    const std::string operation = normalizeSelector(requiredString(args, "operation"));
    bool encrypt = true;
    if (operation == "encrypt") {
        encrypt = true;
    } else if (operation == "decrypt") {
        encrypt = false;
    } else {
        AbiError error(ErrorCode::BadArgument,
                       "Argument 'operation' must be \"encrypt\" or \"decrypt\".");
        error.addDetail("arg", json::Value("operation"));
        json::Value allowed = json::Value::array();
        allowed.push(json::Value("encrypt"));
        allowed.push(json::Value("decrypt"));
        error.addDetail("allowed", allowed);
        throw error;
    }

    const std::vector<unsigned char> input = payloadBytes(args);
    const std::string keyHex = requiredString(args, "keyHex");
    (void)hexBytes(keyHex, "keyHex");   // reject bad key hex as BAD_HEX, not CRYPTO_FAILED
    const std::string ivHex = optionalString(args, "ivHex");
    if (!ivHex.empty()) {
        (void)hexBytes(ivHex, "ivHex");
    }
    const bool usePadding = optionalBool(args, "usePadding", false);

    const CryptoResult result =
        CryptoEngine::transform(algorithm, encrypt, input, keyHex, ivHex, usePadding);
    if (!result.ok) {
        fail(ErrorCode::CryptoFailed, result.error);
    }

    json::Value data = json::Value::object();
    data.set("hex", json::Value(toHex(result.bytes, true)));
    data.set("text", json::Value(bytesString(result.bytes)));
    data.set("byteLength", json::Value(static_cast<long long>(result.bytes.size())));
    return data;
}

// ---------------------------------------------------------------------------
// pin.*
// ---------------------------------------------------------------------------

// Classic PIN block encryption: single DES for an 8-byte key, 3DES-ECB for a
// double- or triple-length key. Never padded -- a PIN block is exactly as long
// as it is, and PKCS#7 would change its length.
std::string pinCipherForKey(std::size_t keyByteCount) {
    if (keyByteCount == 8) {
        return "des-ecb";
    }
    if (keyByteCount == 16 || keyByteCount == 24) {
        return "3des-ecb";
    }
    failArg(ErrorCode::BadLength, "keyHex",
            "PIN encryption key must be 16, 32, or 48 hex characters (8, 16, or 24 bytes).");
}

std::vector<unsigned char> readPinBlock(const json::Value& args, const char* key = "blockHex") {
    const std::vector<unsigned char> block = requiredHexBytes(args, key);
    if (block.empty() || (block.size() % 8) != 0) {
        failArg(ErrorCode::BadLength, key,
                "A PIN block must be a whole number of 8-byte blocks.");
    }
    return block;
}

std::string readPinFormat(const json::Value& args) {
    const std::string format = normalizeSelector(requiredString(args, "format"));
    if (format == "iso0" || format == "iso1" || format == "iso3" || format == "iso4") {
        return format;
    }
    AbiError error(ErrorCode::BadArgument,
                   "Argument 'format' must be \"iso0\", \"iso1\", \"iso3\", or \"iso4\".");
    error.addDetail("arg", json::Value("format"));
    json::Value allowed = json::Value::array();
    allowed.push(json::Value("iso0"));
    allowed.push(json::Value("iso1"));
    allowed.push(json::Value("iso3"));
    allowed.push(json::Value("iso4"));
    error.addDetail("allowed", allowed);
    throw error;
}

json::Value opPinCreate(bufferx_session&, const json::Value& args) {
    const std::string format = readPinFormat(args);
    const std::string pin = requiredString(args, "pin");

    PinBlockResult result;
    if (format == "iso1") {
        result = pinblock::createIso1(pin);
    } else if (format == "iso0") {
        result = pinblock::createIso0(pin, requiredString(args, "pan"));
    } else if (format == "iso3") {
        result = pinblock::createIso3(pin, requiredString(args, "pan"));
    } else {
        result = pinblock::encryptIso4(pin, requiredString(args, "pan"),
                                       requiredString(args, "keyHex"));
    }
    if (!result.ok) {
        fail(ErrorCode::CryptoFailed, result.error);
    }

    json::Value data = json::Value::object();
    data.set("hex", json::Value(toHex(result.bytes, true)));
    data.set("pin", json::Value(result.pin));
    return data;
}

json::Value opPinDecode(bufferx_session&, const json::Value& args) {
    const std::string format = readPinFormat(args);
    const std::vector<unsigned char> block = requiredHexBytes(args, "blockHex");

    PinBlockResult result;
    if (format == "iso1") {
        result = pinblock::decodeIso1(block);
    } else if (format == "iso0") {
        result = pinblock::decodeIso0(block, requiredString(args, "pan"));
    } else if (format == "iso3") {
        result = pinblock::decodeIso3(block, requiredString(args, "pan"));
    } else {
        result = pinblock::decryptIso4(block, requiredString(args, "pan"),
                                       requiredString(args, "keyHex"));
    }
    if (!result.ok) {
        fail(ErrorCode::CryptoFailed, result.error);
    }

    json::Value data = json::Value::object();
    data.set("pin", json::Value(result.pin));
    return data;
}

json::Value pinTransform(const json::Value& args, bool encrypt) {
    const std::vector<unsigned char> block = readPinBlock(args);
    const std::string keyHex = requiredString(args, "keyHex");
    const std::vector<unsigned char> key = hexBytes(keyHex, "keyHex");
    const std::string algorithm = pinCipherForKey(key.size());

    const CryptoResult result =
        CryptoEngine::transform(algorithm, encrypt, block, keyHex, std::string(), false);
    if (!result.ok) {
        fail(ErrorCode::CryptoFailed, result.error);
    }

    json::Value data = json::Value::object();
    data.set("hex", json::Value(toHex(result.bytes, true)));
    return data;
}

json::Value opPinEncrypt(bufferx_session&, const json::Value& args) {
    return pinTransform(args, true);
}

json::Value opPinDecrypt(bufferx_session&, const json::Value& args) {
    return pinTransform(args, false);
}

// The PVKI is one decimal digit, which a form will send as the string "1" and a
// numeric input will send as 1. Both are the same request; rejecting either
// would be a distinction without a difference, so both are accepted and
// normalized to the single character the core expects.
std::string readPvki(const json::Value& args) {
    const json::Value* value = member(args, "pvki");
    if (value == nullptr || value->isNull()) {
        badArgument("pvki", "Argument 'pvki' is required.");
    }
    if (value->isNumber()) {
        const int digit = value->asInt(-1);
        if (digit < 0 || digit > 9) {
            badArgument("pvki", "Argument 'pvki' must be a single decimal digit 0-9.");
        }
        return std::string(1, static_cast<char>('0' + digit));
    }
    if (!value->isString()) {
        badArgument("pvki", "Argument 'pvki' must be a decimal digit, as a string or a number.");
    }
    return value->asString();
}

json::Value opPinVisaPvv(bufferx_session&, const json::Value& args) {
    const PinVerificationResult result = pinverification::visaPvv(requiredString(args, "pin"),
                                                                  requiredString(args, "pan"),
                                                                  readPvki(args),
                                                                  requiredString(args, "pvkHex"));
    if (!result.ok) {
        fail(ErrorCode::CryptoFailed, result.error);
    }
    json::Value data = json::Value::object();
    data.set("pvv", json::Value(result.value));
    return data;
}

json::Value opPinIbm3624Offset(bufferx_session&, const json::Value& args) {
    const PinVerificationResult result =
        pinverification::ibm3624Offset(requiredString(args, "pin"),
                                       requiredString(args, "validationData"),
                                       requiredString(args, "decimalizationTable"),
                                       requiredString(args, "pvkHex"));
    if (!result.ok) {
        fail(ErrorCode::CryptoFailed, result.error);
    }
    json::Value data = json::Value::object();
    data.set("offset", json::Value(result.value));
    return data;
}

json::Value opPinVerifyIbm3624(bufferx_session&, const json::Value& args) {
    const PinVerificationResult result =
        pinverification::verifyIbm3624(requiredString(args, "pin"),
                                       requiredString(args, "offset"),
                                       requiredString(args, "validationData"),
                                       requiredString(args, "decimalizationTable"),
                                       requiredString(args, "pvkHex"));
    if (!result.ok) {
        fail(ErrorCode::CryptoFailed, result.error);
    }
    // A PIN that does not verify is a result, not an error.
    json::Value data = json::Value::object();
    data.set("valid", json::Value(result.value == "VALID"));
    data.set("naturalPin", json::Value(result.naturalPin));
    return data;
}

json::Value opPinTranslateAtm(bufferx_session&, const json::Value& args) {
    const std::vector<unsigned char> block = readPinBlock(args);
    const PinTranslationResult result =
        pintranslation::translate(block,
                                  requiredString(args, "pan"),
                                  requiredString(args, "sourceFormat"),
                                  requiredString(args, "sourceAlgorithm"),
                                  requiredString(args, "sourceKeyHex"),
                                  requiredString(args, "destinationFormat"),
                                  requiredString(args, "destinationAlgorithm"),
                                  requiredString(args, "destinationKeyHex"));
    if (!result.ok) {
        fail(ErrorCode::CryptoFailed, result.error);
    }

    json::Value data = json::Value::object();
    data.set("translatedHex", json::Value(toHex(result.translatedBlock, true)));
    data.set("clearHex", json::Value(toHex(result.clearBlock, true)));
    data.set("pin", json::Value(result.pin));
    return data;
}

// ---------------------------------------------------------------------------
// rsa.*
// ---------------------------------------------------------------------------

json::Value opRsaSign(bufferx_session&, const json::Value& args) {
    const RsaShaResult result = rsasha::signBase64(requiredString(args, "payload"),
                                                   requiredNonEmptyString(args, "privateKeyPem"),
                                                   requiredString(args, "digest"));
    if (!result.ok) {
        fail(ErrorCode::CryptoFailed, result.error);
    }
    json::Value data = json::Value::object();
    data.set("signature", json::Value(result.base64));
    return data;
}

json::Value opRsaVerify(bufferx_session&, const json::Value& args) {
    const RsaShaResult result = rsasha::verifyBase64(requiredString(args, "payload"),
                                                     requiredNonEmptyString(args, "publicKeyPem"),
                                                     requiredNonEmptyString(args, "signature"),
                                                     requiredString(args, "digest"));
    if (!result.ok) {
        fail(ErrorCode::CryptoFailed, result.error);
    }
    // A signature that does not verify is a result, not an error.
    json::Value data = json::Value::object();
    data.set("valid", json::Value(result.verified));
    return data;
}

json::Value opRsaEncrypt(bufferx_session&, const json::Value& args) {
    const RsaCipherResult result = rsasha::encryptBase64(requiredString(args, "payload"),
                                                         requiredNonEmptyString(args, "publicKeyPem"),
                                                         requiredString(args, "padding"));
    if (!result.ok) {
        fail(ErrorCode::CryptoFailed, result.error);
    }
    json::Value data = json::Value::object();
    data.set("ciphertext", json::Value(result.base64));
    return data;
}

json::Value opRsaDecrypt(bufferx_session&, const json::Value& args) {
    const RsaCipherResult result = rsasha::decryptBase64(requiredNonEmptyString(args, "ciphertext"),
                                                         requiredNonEmptyString(args, "privateKeyPem"),
                                                         requiredString(args, "padding"));
    if (!result.ok) {
        fail(ErrorCode::CryptoFailed, result.error);
    }
    json::Value data = json::Value::object();
    data.set("plaintext", json::Value(result.plaintext));
    return data;
}

// ---------------------------------------------------------------------------
// tlv.*
// ---------------------------------------------------------------------------

// tlvtool::parse reports malformed input by throwing; that is the only place in
// the core that does, and it is converted here so PARSE_FAILED reaches the
// caller instead of INTERNAL.
std::vector<tlvtool::Node> parseTlv(const std::vector<unsigned char>& payload,
                                    const std::string& arg) {
    const std::vector<uint8_t> buffer(payload.begin(), payload.end());
    try {
        return tlvtool::parse(buffer);
    } catch (const std::exception& error) {
        failArg(ErrorCode::ParseFailed, arg, error.what());
    } catch (...) {
        failArg(ErrorCode::ParseFailed, arg, "TLV parsing failed.");
    }
}

// The encoded length a node occupies: for a primitive that is its value, for a
// composite the total size of its encoded children.
std::size_t tlvPayloadLength(const tlvtool::Node& node) {
    if (!node.isComposite()) {
        return node.value.size();
    }
    std::size_t total = 0;
    for (const tlvtool::Node& child : node.children) {
        total += child.encode().size();
    }
    return total;
}

// Display renderings use the space-separated hex the tree and inline views
// already emit, so a tag copied out of the node list matches the tag shown in
// the tree beside it.
json::Value tlvNodeValue(const tlvtool::Node& node) {
    json::Value out = json::Value::object();
    out.set("tag", json::Value(tlvtool::toHex(node.tag, ' ')));
    out.set("length", json::Value(static_cast<long long>(tlvPayloadLength(node))));
    out.set("value", json::Value(tlvtool::toHex(node.value, ' ')));
    out.set("ascii", json::Value(tlvtool::toAsciiDebug(node.value)));
    out.set("composite", json::Value(node.isComposite()));

    json::Value children = json::Value::array();
    for (const tlvtool::Node& child : node.children) {
        children.push(tlvNodeValue(child));
    }
    out.set("children", children);
    return out;
}

std::size_t countTlvNodes(const std::vector<tlvtool::Node>& nodes) {
    std::size_t total = 0;
    for (const tlvtool::Node& node : nodes) {
        total += 1 + countTlvNodes(node.children);
    }
    return total;
}

json::Value opTlvParse(bufferx_session&, const json::Value& args) {
    const std::vector<unsigned char> payload = payloadBytes(args);
    const std::vector<tlvtool::Node> nodes = parseTlv(payload, "payload");

    json::Value nodeArray = json::Value::array();
    for (const tlvtool::Node& node : nodes) {
        nodeArray.push(tlvNodeValue(node));
    }

    json::Value flatArray = json::Value::array();
    for (const tlvtool::FlatEntry& entry : tlvtool::flatten(nodes)) {
        json::Value flat = json::Value::object();
        flat.set("path", json::Value(entry.path));
        flat.set("description", json::Value(entry.description));
        flat.set("tag", json::Value(tlvtool::toHex(entry.tag, ' ')));
        flat.set("value", json::Value(tlvtool::toHex(entry.value, ' ')));
        flat.set("ascii", json::Value(tlvtool::toAsciiDebug(entry.value)));
        flatArray.push(flat);
    }

    json::Value data = json::Value::object();
    data.set("nodes", nodeArray);
    data.set("tree", json::Value(tlvtool::buildTreeText(nodes)));
    data.set("flat", flatArray);
    data.set("inline", json::Value(tlvtool::buildInlineText(nodes)));
    return data;
}

json::Value opTlvBuild(bufferx_session&, const json::Value& args) {
    const std::vector<unsigned char> tag = requiredHexBytes(args, "tagHex");
    if (tag.empty()) {
        failArg(ErrorCode::BadLength, "tagHex", "A TLV tag must be at least one byte.");
    }

    tlvtool::Node node;
    node.tag.assign(tag.begin(), tag.end());
    const bool tagIsConstructed = node.isComposite();

    // The constructed bit lives in the tag. `constructed` asserts what the
    // caller believes the tag says; a disagreement is a mistake worth reporting
    // rather than silently resolving in either direction.
    const json::Value* declared = member(args, "constructed");
    if (declared != nullptr && !declared->isNull()) {
        const bool wanted = optionalBool(args, "constructed", tagIsConstructed);
        if (wanted != tagIsConstructed) {
            badArgument("constructed",
                        tagIsConstructed
                            ? "Tag has the constructed bit (0x20) set, so 'constructed' must be true."
                            : "Tag does not have the constructed bit (0x20) set, so 'constructed' "
                              "must be false.");
        }
    }

    const std::string payload = optionalString(args, "payload");
    std::vector<unsigned char> value;
    if (!payload.empty()) {
        value = optionalBool(args, "valueIsHex", true) ? hexBytes(payload, "payload")
                                                       : stringBytes(payload);
    }

    if (tagIsConstructed) {
        // A constructed node's payload is itself a sequence of TLVs; parsing it
        // here means a malformed child is caught now rather than by whoever
        // reads the message later.
        node.children = parseTlv(value, "payload");
    } else {
        node.value.assign(value.begin(), value.end());
    }

    const std::vector<uint8_t> encoded = node.encode();
    json::Value data = json::Value::object();
    data.set("hex", json::Value(toHex(std::vector<unsigned char>(encoded.begin(), encoded.end()), true)));
    return data;
}

json::Value opTlvValidate(bufferx_session&, const json::Value& args) {
    const std::vector<unsigned char> payload = payloadBytes(args);
    const std::vector<uint8_t> buffer(payload.begin(), payload.end());

    // Validation reports its verdict as data. Only a malformed *request* is an
    // error envelope; a malformed *buffer* is exactly what was asked about.
    json::Value data = json::Value::object();
    try {
        const std::vector<tlvtool::Node> nodes = tlvtool::parse(buffer);
        data.set("valid", json::Value(true));
        data.set("message", json::Value(std::string("TLV structure is well-formed.")));
        data.set("nodeCount", json::Value(static_cast<long long>(countTlvNodes(nodes))));
    } catch (const std::exception& error) {
        data.set("valid", json::Value(false));
        data.set("message", json::Value(std::string(error.what())));
        data.set("nodeCount", json::Value(0));
    }
    return data;
}

void appendTlvXml(const tlvtool::Node& node, int depth, std::string& out) {
    const std::string indent(static_cast<std::size_t>(depth) * 2 + 2, ' ');
    const std::vector<unsigned char> tag(node.tag.begin(), node.tag.end());
    out += indent + "<Node tag=\"" + xmllite::escape(toHex(tag, true)) + "\"";
    if (node.isComposite()) {
        out += " constructed=\"true\">\n";
        for (const tlvtool::Node& child : node.children) {
            appendTlvXml(child, depth + 1, out);
        }
        out += indent + "</Node>\n";
        return;
    }
    const std::vector<unsigned char> value(node.value.begin(), node.value.end());
    out += " value=\"" + xmllite::escape(toHex(value, true)) + "\" />\n";
}

json::Value opTlvToXml(bufferx_session&, const json::Value& args) {
    const std::vector<unsigned char> payload = payloadBytes(args);
    const std::vector<tlvtool::Node> nodes = parseTlv(payload, "payload");

    std::string xml = "<Tlv>\n";
    for (const tlvtool::Node& node : nodes) {
        appendTlvXml(node, 0, xml);
    }
    xml += "</Tlv>\n";

    json::Value data = json::Value::object();
    data.set("xml", json::Value(xml));
    return data;
}

tlvtool::Node readTlvXmlNode(const xmllite::Element& element, const std::string& path) {
    const std::string* tagText = element.attribute("tag");
    if (tagText == nullptr) {
        failArg(ErrorCode::ParseFailed, "xml", path + " is missing the required 'tag' attribute.");
    }
    const std::vector<unsigned char> tag = hexBytes(trimmed(*tagText), "xml");
    if (tag.empty()) {
        failArg(ErrorCode::ParseFailed, "xml", path + " has an empty 'tag' attribute.");
    }

    tlvtool::Node node;
    node.tag.assign(tag.begin(), tag.end());

    const std::vector<const xmllite::Element*> children = element.childrenNamed("Node");
    const std::string* valueText = element.attribute("value");

    if (node.isComposite()) {
        if (valueText != nullptr && !trimmed(*valueText).empty()) {
            failArg(ErrorCode::ParseFailed, "xml",
                    path + " has a constructed tag and therefore carries child nodes, not a "
                           "'value' attribute.");
        }
        for (std::size_t index = 0; index < children.size(); ++index) {
            node.children.push_back(
                readTlvXmlNode(*children[index], path + "/Node[" + std::to_string(index) + "]"));
        }
        return node;
    }

    if (!children.empty()) {
        failArg(ErrorCode::ParseFailed, "xml",
                path + " has child nodes but its tag is primitive; set the constructed bit "
                       "(0x20) in the tag.");
    }
    if (valueText != nullptr) {
        const std::vector<unsigned char> value = hexBytes(trimmed(*valueText), "xml");
        node.value.assign(value.begin(), value.end());
    }
    return node;
}

json::Value opTlvFromXml(bufferx_session&, const json::Value& args) {
    const std::string xml = requiredNonEmptyString(args, "xml");
    const xmllite::ParseResult parsed = xmllite::parse(xml);
    if (!parsed.ok) {
        failArg(ErrorCode::ParseFailed, "xml",
                "XML parse error at line " + std::to_string(parsed.line) + ", column " +
                    std::to_string(parsed.column) + ": " + parsed.error);
    }

    const std::vector<const xmllite::Element*> roots = parsed.root.childrenNamed("Node");
    if (roots.empty()) {
        failArg(ErrorCode::ParseFailed, "xml",
                "The document contains no <Node> elements; expected <Tlv><Node tag=\"...\"/></Tlv>.");
    }

    std::vector<unsigned char> encoded;
    for (std::size_t index = 0; index < roots.size(); ++index) {
        const tlvtool::Node node =
            readTlvXmlNode(*roots[index], "Node[" + std::to_string(index) + "]");
        const std::vector<uint8_t> bytes = node.encode();
        encoded.insert(encoded.end(), bytes.begin(), bytes.end());
    }

    json::Value data = json::Value::object();
    data.set("hex", json::Value(toHex(encoded, true)));
    return data;
}

// ---------------------------------------------------------------------------
// tools.*
// ---------------------------------------------------------------------------

json::Value opToolsRun(bufferx_session&, const json::Value& args) {
    const std::string operation = requiredNonEmptyString(args, "operation");
    const BankingToolResult result = bankingtools::run(operation,
                                                       optionalString(args, "input"),
                                                       optionalString(args, "secondary"),
                                                       optionalInt(args, "parameter", 0));
    if (!result.ok) {
        // The one failure that is about the request rather than the input: an
        // operation this build does not implement.
        if (result.error.find("Unsupported banking utility operation") != std::string::npos) {
            failArg(ErrorCode::Unsupported, "operation", result.error);
        }
        failArg(ErrorCode::BadArgument, "input", result.error);
    }

    json::Value data = json::Value::object();
    data.set("output", json::Value(result.output));
    return data;
}

// ---------------------------------------------------------------------------
// text.*
// ---------------------------------------------------------------------------

json::Value opTextUtf8ToHex(bufferx_session&, const json::Value& args) {
    json::Value data = json::Value::object();
    data.set("hex", json::Value(toHex(stringBytes(requiredString(args, "text")), true)));
    return data;
}

json::Value opTextHexToUtf8(bufferx_session&, const json::Value& args) {
    json::Value data = json::Value::object();
    data.set("text", json::Value(bytesString(requiredHexBytes(args, "hex"))));
    return data;
}

json::Value opTextIranSystemToUnicode(bufferx_session&, const json::Value& args) {
    const iransystem::ConversionResult result = iransystem::toUnicode(payloadBytes(args));
    if (!result.ok) {
        failArg(ErrorCode::Unsupported, "payload", result.error);
    }
    json::Value data = json::Value::object();
    data.set("text", json::Value(result.text));
    return data;
}

json::Value opTextUnicodeToIranSystem(bufferx_session&, const json::Value& args) {
    const iransystem::ConversionResult result =
        iransystem::fromUnicode(requiredString(args, "text"),
                                optionalBool(args, "convertNumbers", false));
    if (!result.ok) {
        failArg(ErrorCode::Unsupported, "text", result.error);
    }
    // `hex` is the converted IranSystem byte string; `text` is the core's echo
    // of the input, which is what this conversion has always returned. Use
    // text.utf8ToIranSystemText when a readable rendering of the result is
    // wanted instead.
    json::Value data = json::Value::object();
    data.set("hex", json::Value(toHex(result.bytes, true)));
    data.set("text", json::Value(result.text));
    return data;
}

json::Value opTextIranSystemTextToUtf8(bufferx_session&, const json::Value& args) {
    const iransystem::ConversionResult result =
        iransystem::toUnicodeFromText(requiredString(args, "text"));
    if (!result.ok) {
        failArg(ErrorCode::Unsupported, "text", result.error);
    }
    json::Value data = json::Value::object();
    data.set("text", json::Value(result.text));
    return data;
}

json::Value opTextUtf8ToIranSystemText(bufferx_session&, const json::Value& args) {
    const iransystem::ConversionResult result =
        iransystem::fromUnicodeToText(requiredString(args, "text"),
                                      optionalBool(args, "convertNumbers", false));
    if (!result.ok) {
        failArg(ErrorCode::Unsupported, "text", result.error);
    }
    json::Value data = json::Value::object();
    data.set("text", json::Value(result.text));
    data.set("hex", json::Value(toHex(result.bytes, true)));
    return data;
}

json::Value opTextAtmIranSystemToUnicode(bufferx_session&, const json::Value& args) {
    const iransystem::ConversionResult result = iransystem::toAtmEngineUnicode(payloadBytes(args));
    if (!result.ok) {
        failArg(ErrorCode::Unsupported, "payload", result.error);
    }
    json::Value data = json::Value::object();
    data.set("text", json::Value(result.text));
    return data;
}

json::Value opTextUnicodeToAtmIranSystem(bufferx_session&, const json::Value& args) {
    const iransystem::ConversionResult result =
        iransystem::fromUnicodeAtmEngine(requiredString(args, "text"),
                                         optionalBool(args, "convertNumbers", false));
    if (!result.ok) {
        failArg(ErrorCode::Unsupported, "text", result.error);
    }
    json::Value data = json::Value::object();
    data.set("hex", json::Value(toHex(result.bytes, true)));
    data.set("text", json::Value(result.text));
    return data;
}

// ANSI here means Windows-1256, the Persian code page these hosts use. A JSON
// string cannot carry arbitrary CP1256 bytes -- it must be valid UTF-8 -- so the
// two text-in/text-out ops use the byte-string convention described at
// `bytesToLatin1`: each byte travels as the codepoint of the same value. The
// `*Hex*` variants are the unambiguous path and should be preferred by anything
// that already holds bytes.
json::Value opTextAnsiToUtf8(bufferx_session&, const json::Value& args) {
    const std::vector<unsigned char> bytes = latin1ToBytes(requiredString(args, "text"), "text");
    json::Value data = json::Value::object();
    data.set("text", json::Value(textcodec::cp1256ToUtf8(bytes)));
    return data;
}

json::Value opTextUtf8ToAnsi(bufferx_session&, const json::Value& args) {
    const std::vector<unsigned char> bytes = textcodec::utf8ToCp1256(requiredString(args, "text"));
    json::Value data = json::Value::object();
    data.set("text", json::Value(bytesToLatin1(bytes)));
    return data;
}

json::Value opTextAnsiHexToUtf8(bufferx_session&, const json::Value& args) {
    json::Value data = json::Value::object();
    data.set("text", json::Value(textcodec::cp1256ToUtf8(requiredHexBytes(args, "hex"))));
    return data;
}

json::Value opTextUtf8ToAnsiHex(bufferx_session&, const json::Value& args) {
    const std::vector<unsigned char> bytes = textcodec::utf8ToCp1256(requiredString(args, "text"));
    json::Value data = json::Value::object();
    data.set("hex", json::Value(toHex(bytes, true)));
    return data;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

using Handler = json::Value (*)(bufferx_session&, const json::Value&);

const std::unordered_map<std::string, Handler>& handlers() {
    static const std::unordered_map<std::string, Handler> table = {
        {"engine.version",      &opEngineVersion},
        {"engine.capabilities", &opEngineCapabilities},

        {"packager.loadXml",    &opPackagerLoadXml},
        {"packager.list",       &opPackagerList},
        {"packager.fields",     &opPackagerFields},

        {"iso.decode",          &opIsoDecode},
        {"iso.encode",          &opIsoEncode},

        {"mac.calculate",       &opMacCalculate},
        {"mac.verify",          &opMacVerify},

        {"crypto.transform",    &opCryptoTransform},

        {"pin.create",          &opPinCreate},
        {"pin.decode",          &opPinDecode},
        {"pin.encrypt",         &opPinEncrypt},
        {"pin.decrypt",         &opPinDecrypt},
        {"pin.visaPvv",         &opPinVisaPvv},
        {"pin.ibm3624Offset",   &opPinIbm3624Offset},
        {"pin.verifyIbm3624",   &opPinVerifyIbm3624},
        {"pin.translateAtm",    &opPinTranslateAtm},

        {"rsa.sign",            &opRsaSign},
        {"rsa.verify",          &opRsaVerify},
        {"rsa.encrypt",         &opRsaEncrypt},
        {"rsa.decrypt",         &opRsaDecrypt},

        {"tlv.parse",           &opTlvParse},
        {"tlv.build",           &opTlvBuild},
        {"tlv.validate",        &opTlvValidate},
        {"tlv.toXml",           &opTlvToXml},
        {"tlv.fromXml",         &opTlvFromXml},

        {"tools.run",           &opToolsRun},

        {"text.utf8ToHex",                  &opTextUtf8ToHex},
        {"text.hexToUtf8",                  &opTextHexToUtf8},
        {"text.iranSystemToUnicode",        &opTextIranSystemToUnicode},
        {"text.unicodeToIranSystem",        &opTextUnicodeToIranSystem},
        {"text.iranSystemTextToUtf8",       &opTextIranSystemTextToUtf8},
        {"text.utf8ToIranSystemText",       &opTextUtf8ToIranSystemText},
        {"text.atmEngineIranSystemToUnicode", &opTextAtmIranSystemToUnicode},
        {"text.unicodeToAtmEngineIranSystem", &opTextUnicodeToAtmIranSystem},
        {"text.ansiToUtf8",                 &opTextAnsiToUtf8},
        {"text.utf8ToAnsi",                 &opTextUtf8ToAnsi},
        {"text.ansiHexToUtf8",              &opTextAnsiHexToUtf8},
        {"text.utf8ToAnsiHex",              &opTextUtf8ToAnsiHex},
    };
    return table;
}

std::string successEnvelope(const json::Value& data) {
    json::Value envelope = json::Value::object();
    envelope.set("ok", json::Value(true));
    envelope.set("data", data);
    return envelope.serialize();
}

std::string errorEnvelope(ErrorCode code, const std::string& message, const json::Value* detail) {
    json::Value error = json::Value::object();
    error.set("code", json::Value(errorCodeName(code)));
    error.set("message", json::Value(message));
    if (detail != nullptr) {
        error.set("detail", *detail);
    }
    json::Value envelope = json::Value::object();
    envelope.set("ok", json::Value(false));
    envelope.set("error", error);
    return envelope.serialize();
}

std::string errorEnvelope(ErrorCode code, const std::string& message) {
    return errorEnvelope(code, message, nullptr);
}

std::string errorEnvelope(const AbiError& error) {
    return errorEnvelope(error.code(), error.message(),
                         error.hasDetail() ? &error.detail() : nullptr);
}

// Runs one request end to end. Every failure path returns an envelope; nothing
// here throws to its caller except std::bad_alloc from building the response
// string, which bufferx_invoke handles.
std::string dispatch(bufferx_session& session, const char* requestJson) {
    if (requestJson == nullptr) {
        return errorEnvelope(ErrorCode::BadArgument, "The request pointer was null.");
    }

    const json::ParseResult parsed = json::parse(requestJson);
    if (!parsed.ok) {
        json::Value detail = json::Value::object();
        detail.set("offset", json::Value(static_cast<long long>(parsed.offset)));
        return errorEnvelope(ErrorCode::BadArgument,
                             "The request is not valid JSON: " + parsed.error, &detail);
    }
    const json::Value& request = parsed.value;
    if (!request.isObject()) {
        return errorEnvelope(ErrorCode::BadArgument, "The request must be a JSON object.");
    }

    const json::Value* version = request.find("v");
    if (version == nullptr || !version->isNumber()) {
        return errorEnvelope(ErrorCode::BadArgument,
                             "The request must carry a numeric protocol version 'v'.");
    }
    if (version->asInt(-1) != BUFFERX_ABI_PROTOCOL) {
        json::Value detail = json::Value::object();
        detail.set("expected", json::Value(BUFFERX_ABI_PROTOCOL));
        return errorEnvelope(ErrorCode::Unsupported,
                             "This engine serves protocol version " +
                                 std::to_string(BUFFERX_ABI_PROTOCOL) + ".",
                             &detail);
    }

    const json::Value* op = request.find("op");
    if (op == nullptr || !op->isString()) {
        return errorEnvelope(ErrorCode::BadArgument,
                             "The request must carry an operation name 'op'.");
    }
    const std::string opName = op->asString();

    // An absent `args` is read as `{}` so no-argument ops need not carry an
    // empty object; a present-but-not-an-object `args` is a mistake.
    static const json::Value kEmptyArgs = json::Value::object();
    const json::Value* args = request.find("args");
    if (args != nullptr && !args->isNull() && !args->isObject()) {
        return errorEnvelope(ErrorCode::BadArgument, "The request's 'args' must be an object.");
    }
    const json::Value& arguments =
        (args == nullptr || args->isNull()) ? kEmptyArgs : *args;

    const auto handler = handlers().find(opName);
    if (handler == handlers().end()) {
        json::Value detail = json::Value::object();
        detail.set("op", json::Value(opName));
        return errorEnvelope(ErrorCode::UnknownOp, "Unknown operation: " + opName, &detail);
    }

    try {
        return successEnvelope(handler->second(session, arguments));
    } catch (const AbiError& error) {
        return errorEnvelope(error);
    } catch (const std::bad_alloc&) {
        return errorEnvelope(ErrorCode::Internal, "The engine ran out of memory.");
    } catch (const std::exception& error) {
        return errorEnvelope(ErrorCode::Internal,
                             std::string("The engine hit an unexpected fault: ") + error.what());
    } catch (...) {
        return errorEnvelope(ErrorCode::Internal, "The engine hit an unclassified fault.");
    }
}

// Returned when even the error envelope could not be allocated. Mutable static
// storage so it can be handed back as `char*`; bufferx_string_free recognizes
// it by address and leaves it alone.
char kAllocationFailureResponse[] =
    "{\"ok\":false,\"error\":{\"code\":\"INTERNAL\",\"message\":\"The engine could not allocate a "
    "response.\"}}";

char* duplicate(const std::string& text) {
    char* copy = static_cast<char*>(std::malloc(text.size() + 1));
    if (copy == nullptr) {
        return kAllocationFailureResponse;
    }
    std::memcpy(copy, text.c_str(), text.size() + 1);
    return copy;
}

// Fills a new session with the packager definitions compiled in from
// data/packagers.xml, so it can decode a buffer the moment it opens.
//
// A failure here is deliberately silent: the built-in document is validated by
// the test suite, and an engine that refuses to open because of a data problem
// is worse than one that opens with an empty registry the operator can fill via
// packager.loadXml. `packager.list` reports what actually loaded.
void loadBuiltinPackagers(bufferx_session& session) {
    try {
        const PackagerLoadResult result = PackagerLoader::loadFromXml(bufferx::kDefaultPackagersXml);
        if (result.ok) {
            session.packagers = result.packagers;
        }
    } catch (...) {
        // Leave the registry empty.
    }
}

// The process-wide session that serves callers passing NULL. Constructed on
// first use; never destroyed, because a static destructor could run while a
// late caller still holds the pointer.
bufferx_session& defaultSession() {
    static bufferx_session* session = [] {
        auto* created = new bufferx_session();
        loadBuiltinPackagers(*created);
        return created;
    }();
    return *session;
}

} // namespace

// ---------------------------------------------------------------------------
// C ABI
// ---------------------------------------------------------------------------

extern "C" {

bufferx_session* bufferx_open(void) {
    try {
        auto* session = new bufferx_session();
        loadBuiltinPackagers(*session);
        return session;
    } catch (...) {
        return nullptr;
    }
}

void bufferx_close(bufferx_session* session) {
    // A null pointer means "the default session", which outlives every caller
    // and must not be destroyed here.
    if (session == nullptr) {
        return;
    }
    delete session;
}

char* bufferx_invoke(bufferx_session* session, const char* request_json) {
    std::string response;
    try {
        response = dispatch(session == nullptr ? defaultSession() : *session, request_json);
    } catch (...) {
        // dispatch() converts handler faults itself; reaching here means the
        // response string itself could not be built.
        return kAllocationFailureResponse;
    }
    return duplicate(response);
}

void bufferx_string_free(char* text) {
    if (text == nullptr || text == kAllocationFailureResponse) {
        return;
    }
    std::free(text);
}

const char* bufferx_version(void) {
    return BUFFERX_ABI_VERSION;
}

} // extern "C"
