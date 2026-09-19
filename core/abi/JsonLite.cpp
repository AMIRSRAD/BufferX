#include "JsonLite.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <clocale>
#include <limits>
#include <utility>

// The parser recurses once per level of nesting, so anything the compiler
// parks in parseValue/parseArray/parseObject is paid kMaxDepth times over.
// Error reporting and leaf values are pushed out of line so their locals --
// std::string temporaries for messages, a whole Value for a literal -- live in
// a frame that is not on the recursive path. Measured on MSVC x64, this cuts
// peak stack at kMaxDepth by 2-5x (nested objects: 164 KB -> 76 KB optimized,
// 456 KB -> 112 KB unoptimized), which is what decides whether the depth cap
// keeps the parser inside a small wasm stack or merely relocates the crash.
#if defined(_MSC_VER)
#define JSONLITE_COLD __declspec(noinline)
#elif defined(__GNUC__) || defined(__clang__)
#define JSONLITE_COLD __attribute__((noinline))
#else
#define JSONLITE_COLD
#endif

namespace json {
namespace {

// --- UTF-8 -------------------------------------------------------------------

// Decodes the sequence starting at `i`, returning its length in bytes, or 0 if
// the bytes there are not a valid UTF-8 scalar. Overlong forms, encoded
// surrogates, and anything above U+10FFFF are rejected: they are the classic
// way to smuggle a character past a filter that inspected the text earlier.
std::size_t decodeUtf8(const std::string& s, std::size_t i, std::uint32_t& cp) {
    const std::size_t n = s.size();
    if (i >= n) {
        return 0;
    }
    const unsigned char b0 = static_cast<unsigned char>(s[i]);
    if (b0 < 0x80) {
        cp = b0;
        return 1;
    }

    std::size_t len = 0;
    std::uint32_t value = 0;
    std::uint32_t lowest = 0;
    if ((b0 & 0xE0) == 0xC0) {
        len = 2;
        value = b0 & 0x1Fu;
        lowest = 0x80;
    } else if ((b0 & 0xF0) == 0xE0) {
        len = 3;
        value = b0 & 0x0Fu;
        lowest = 0x800;
    } else if ((b0 & 0xF8) == 0xF0) {
        len = 4;
        value = b0 & 0x07u;
        lowest = 0x10000;
    } else {
        return 0;   // continuation byte or 5/6-byte form
    }

    if (i + len > n) {
        return 0;
    }
    for (std::size_t k = 1; k < len; ++k) {
        const unsigned char bk = static_cast<unsigned char>(s[i + k]);
        if ((bk & 0xC0) != 0x80) {
            return 0;
        }
        value = (value << 6) | (bk & 0x3Fu);
    }
    if (value < lowest || value > 0x10FFFF || (value >= 0xD800 && value <= 0xDFFF)) {
        return 0;
    }
    cp = value;
    return len;
}

void appendUtf8(std::string& out, std::uint32_t cp) {
    if (cp <= 0x7F) {
        out.push_back(static_cast<char>(cp));
    } else if (cp <= 0x7FF) {
        out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else if (cp <= 0xFFFF) {
        out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    }
}

// --- Numbers -----------------------------------------------------------------

// JSON's decimal separator is '.', but strtod and printf use whatever the
// active C locale says, and a host that ran setlocale(LC_ALL, "") in a Turkish
// or German locale would otherwise read 1.5 as 1 and write it as "1,5". Both
// directions are translated through this rather than assuming '.'.
char localeDecimalPoint() {
    const std::lconv* lc = std::localeconv();
    if (lc != nullptr && lc->decimal_point != nullptr && lc->decimal_point[0] != '\0') {
        return lc->decimal_point[0];
    }
    return '.';
}

// Converts a token that has already been validated against the JSON number
// grammar. Fails only when the result is not finite, i.e. the exponent
// overflowed a double.
bool toDouble(std::string token, double& out) {
    const char point = localeDecimalPoint();
    if (point != '.') {
        for (char& c : token) {
            if (c == '.') {
                c = point;
            }
        }
    }

    const char* first = token.c_str();
    char* last = nullptr;
    const double v = std::strtod(first, &last);
    if (last != first + token.size()) {
        return false;
    }
    if (!std::isfinite(v)) {
        return false;
    }
    out = v;
    return true;
}

std::string formatNumber(double v) {
    // JSON has no infinity or NaN. Emitting null keeps the output parseable,
    // which matters more here than signalling the loss: the alternative is a
    // document the receiving side cannot read at all.
    if (!std::isfinite(v)) {
        return "null";
    }

    // Integral values print as integers, so a round trip of 17 is "17" rather
    // than "17.0". The bound keeps the cast well inside long long's range.
    if (v == std::floor(v) && std::fabs(v) < 1e18) {
        char buf[32];
        std::snprintf(buf, sizeof buf, "%lld", static_cast<long long>(v));
        return buf;
    }

    // Shortest representation that reads back bit-identical. 15 digits covers
    // most values; 17 is enough for every double.
    char buf[64];
    const char point = localeDecimalPoint();
    for (int precision = 15; precision <= 17; ++precision) {
        std::snprintf(buf, sizeof buf, "%.*g", precision, v);
        if (point != '.') {
            for (char* c = buf; *c != '\0'; ++c) {
                if (*c == point) {
                    *c = '.';
                }
            }
        }
        double parsed = 0.0;
        if (precision == 17 || (toDouble(buf, parsed) && parsed == v)) {
            break;
        }
    }
    return buf;
}

// --- String output -----------------------------------------------------------

void writeEscaped(std::string& out, const std::string& s) {
    out.push_back('"');
    const std::size_t n = s.size();
    std::size_t i = 0;
    while (i < n) {
        const unsigned char c = static_cast<unsigned char>(s[i]);
        switch (c) {
        case '"':  out += "\\\""; ++i; continue;
        case '\\': out += "\\\\"; ++i; continue;
        case '\b': out += "\\b";  ++i; continue;
        case '\f': out += "\\f";  ++i; continue;
        case '\n': out += "\\n";  ++i; continue;
        case '\r': out += "\\r";  ++i; continue;
        case '\t': out += "\\t";  ++i; continue;
        default: break;
        }
        if (c < 0x20) {
            char buf[8];
            std::snprintf(buf, sizeof buf, "\\u%04x", static_cast<unsigned>(c));
            out += buf;
            ++i;
            continue;
        }
        if (c < 0x80) {
            out.push_back(static_cast<char>(c));
            ++i;
            continue;
        }
        // Non-ASCII is emitted as-is when it is well-formed UTF-8. A value
        // built in C++ can hold arbitrary bytes (a legacy-encoded field, say),
        // and those become U+FFFD rather than corrupting the output encoding.
        std::uint32_t cp = 0;
        const std::size_t len = decodeUtf8(s, i, cp);
        if (len == 0) {
            out += "\xEF\xBF\xBD";
            ++i;
            continue;
        }
        out.append(s, i, len);
        i += len;
    }
    out.push_back('"');
}

const Value& nullValue() {
    static const Value instance;
    return instance;
}

} // namespace

// --- Value -------------------------------------------------------------------

Value::Value() = default;

Value::Value(bool v) : type_(Type::Bool), bool_(v) {}

Value::Value(double v) : type_(Type::Number), number_(v) {}

Value::Value(int v) : type_(Type::Number), number_(static_cast<double>(v)) {}

Value::Value(long long v) : type_(Type::Number), number_(static_cast<double>(v)) {}

Value::Value(const char* v)
    : type_(v == nullptr ? Type::Null : Type::String), string_(v == nullptr ? "" : v) {}

Value::Value(std::string v) : type_(Type::String), string_(std::move(v)) {}

Value Value::array() {
    Value v;
    v.type_ = Type::Array;
    return v;
}

Value Value::object() {
    Value v;
    v.type_ = Type::Object;
    return v;
}

Value::Type Value::type() const { return type_; }

bool Value::isNull() const { return type_ == Type::Null; }
bool Value::isBool() const { return type_ == Type::Bool; }
bool Value::isNumber() const { return type_ == Type::Number; }
bool Value::isString() const { return type_ == Type::String; }
bool Value::isArray() const { return type_ == Type::Array; }
bool Value::isObject() const { return type_ == Type::Object; }

bool Value::asBool(bool fallback) const {
    return type_ == Type::Bool ? bool_ : fallback;
}

double Value::asNumber(double fallback) const {
    return type_ == Type::Number ? number_ : fallback;
}

int Value::asInt(int fallback) const {
    if (type_ != Type::Number || std::isnan(number_)) {
        return fallback;
    }
    const double truncated = std::trunc(number_);
    // Casting an out-of-range double to int is undefined, so clamp instead.
    if (truncated >= static_cast<double>(std::numeric_limits<int>::max())) {
        return std::numeric_limits<int>::max();
    }
    if (truncated <= static_cast<double>(std::numeric_limits<int>::min())) {
        return std::numeric_limits<int>::min();
    }
    return static_cast<int>(truncated);
}

std::string Value::asString(const std::string& fallback) const {
    return type_ == Type::String ? string_ : fallback;
}

const Value* Value::find(const std::string& key) const {
    if (type_ != Type::Object) {
        return nullptr;
    }
    for (const std::pair<std::string, Value>& member : members_) {
        if (member.first == key) {
            return &member.second;
        }
    }
    return nullptr;
}

bool Value::has(const std::string& key) const {
    return find(key) != nullptr;
}

void Value::set(std::string key, Value value) {
    if (type_ != Type::Object) {
        *this = object();
    }
    for (std::pair<std::string, Value>& member : members_) {
        if (member.first == key) {
            member.second = std::move(value);
            return;
        }
    }
    members_.emplace_back(std::move(key), std::move(value));
}

void Value::push(Value value) {
    if (type_ != Type::Array) {
        *this = array();
    }
    elements_.push_back(std::move(value));
}

std::size_t Value::size() const {
    if (type_ == Type::Array) {
        return elements_.size();
    }
    if (type_ == Type::Object) {
        return members_.size();
    }
    return 0;
}

const Value& Value::at(std::size_t index) const {
    if (type_ == Type::Array && index < elements_.size()) {
        return elements_[index];
    }
    if (type_ == Type::Object && index < members_.size()) {
        return members_[index].second;
    }
    return nullValue();
}

void Value::writeTo(std::string& out, std::size_t depth) const {
    switch (type_) {
    case Type::Null:
        out += "null";
        return;
    case Type::Bool:
        out += bool_ ? "true" : "false";
        return;
    case Type::Number:
        out += formatNumber(number_);
        return;
    case Type::String:
        writeEscaped(out, string_);
        return;
    case Type::Array:
        // A hand-built value can nest deeper than the parser would accept;
        // truncating beats recursing off the end of the stack.
        if (depth >= kMaxDepth) {
            out += "null";
            return;
        }
        out.push_back('[');
        for (std::size_t i = 0; i < elements_.size(); ++i) {
            if (i != 0) {
                out.push_back(',');
            }
            elements_[i].writeTo(out, depth + 1);
        }
        out.push_back(']');
        return;
    case Type::Object:
        if (depth >= kMaxDepth) {
            out += "null";
            return;
        }
        out.push_back('{');
        for (std::size_t i = 0; i < members_.size(); ++i) {
            if (i != 0) {
                out.push_back(',');
            }
            writeEscaped(out, members_[i].first);
            out.push_back(':');
            members_[i].second.writeTo(out, depth + 1);
        }
        out.push_back('}');
        return;
    }
}

std::string Value::serialize() const {
    std::string out;
    writeTo(out, 0);
    return out;
}

// --- Parser ------------------------------------------------------------------

namespace detail {

class Parser {
public:
    explicit Parser(const std::string& text) : text_(text) {}

    ParseResult run() {
        ParseResult result;

        skipByteOrderMark();
        skipWhitespace();

        bool ok = false;
        if (eof()) {
            setError(pos_, "unexpected end of input: expected a value");
        } else if (parseValue(result.value, 1)) {
            skipWhitespace();
            if (eof()) {
                ok = true;
            } else {
                setError(pos_, "unexpected trailing content after the top-level value");
            }
        }

        if (ok) {
            result.ok = true;
            result.offset = pos_;
        } else {
            result.value = Value();   // never hand back a half-built document
            result.ok = false;
            result.error = error_;
            result.offset = errorOffset_;
        }
        return result;
    }

private:
    bool eof() const { return pos_ >= text_.size(); }
    char peek() const { return text_[pos_]; }

    // Only the first error is kept. Because every caller propagates failure
    // immediately, that is the innermost one, which is the one that explains
    // the problem.
    void setError(std::size_t offset, std::string message) {
        if (error_.empty()) {
            error_ = std::move(message);
            errorOffset_ = offset;
        }
    }

    // Every failure path goes through one of these. They are deliberately not
    // inlined: building the message needs std::string temporaries, and those
    // would otherwise occupy stack in the recursive frames that call them.
    JSONLITE_COLD bool fail(std::size_t offset, const char* message) {
        setError(offset, message);
        return false;
    }

    JSONLITE_COLD bool failFound(std::size_t offset, const char* expected, unsigned char found) {
        setError(offset, std::string(expected) + " but found " + describe(found));
        return false;
    }

    JSONLITE_COLD bool failDepth(std::size_t offset) {
        setError(offset, "maximum nesting depth (" + std::to_string(kMaxDepth) + ") exceeded");
        return false;
    }

    JSONLITE_COLD bool failDuplicate(std::size_t offset, const std::string& key) {
        setError(offset, "duplicate member name \"" + key + "\"");
        return false;
    }

    JSONLITE_COLD bool failMissingColon(std::size_t offset, const std::string& key) {
        setError(offset, "expected ':' after member name \"" + key + "\"");
        return false;
    }

    JSONLITE_COLD bool failControlCharacter(std::size_t offset, unsigned char c) {
        char buf[16];
        std::snprintf(buf, sizeof buf, "U+%04X", static_cast<unsigned>(c));
        setError(offset, "unescaped control character " + std::string(buf) + " in string");
        return false;
    }

    JSONLITE_COLD bool failUnknownEscape(std::size_t offset, unsigned char c) {
        setError(offset, "unknown escape sequence \\" + describe(c));
        return false;
    }

    JSONLITE_COLD bool failLiteral(std::size_t offset, const char* literal) {
        setError(offset, std::string("invalid literal: expected '") + literal + "'");
        return false;
    }

    static bool isDigit(char c) { return c >= '0' && c <= '9'; }

    static std::string describe(unsigned char c) {
        if (c >= 0x20 && c < 0x7F) {
            return std::string("'") + static_cast<char>(c) + "'";
        }
        char buf[16];
        std::snprintf(buf, sizeof buf, "byte 0x%02X", static_cast<unsigned>(c));
        return buf;
    }

    void skipByteOrderMark() {
        if (text_.size() >= 3 && static_cast<unsigned char>(text_[0]) == 0xEF &&
            static_cast<unsigned char>(text_[1]) == 0xBB &&
            static_cast<unsigned char>(text_[2]) == 0xBF) {
            pos_ = 3;
        }
    }

    void skipWhitespace() {
        while (!eof()) {
            const char c = peek();
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                ++pos_;
            } else {
                return;
            }
        }
    }

    bool parseLiteral(const char* literal, std::size_t length) {
        if (text_.compare(pos_, length, literal) != 0) {
            return failLiteral(pos_, literal);
        }
        pos_ += length;
        return true;
    }

    // Everything that is not a container. Kept out of line so that the Value
    // temporaries and the decoded string buffer sit in this frame rather than
    // in parseValue's, which is multiplied by the nesting depth.
    JSONLITE_COLD bool parseScalar(Value& out) {
        switch (peek()) {
        case '"': {
            std::string text;
            if (!parseString(text)) {
                return false;
            }
            out = Value(std::move(text));
            return true;
        }
        case 't':
            if (!parseLiteral("true", 4)) {
                return false;
            }
            out = Value(true);
            return true;
        case 'f':
            if (!parseLiteral("false", 5)) {
                return false;
            }
            out = Value(false);
            return true;
        case 'n':
            if (!parseLiteral("null", 4)) {
                return false;
            }
            out = Value();
            return true;
        default:
            return parseNumber(out);
        }
    }

    // The recursive spine. Its frame is deliberately almost empty.
    bool parseValue(Value& out, std::size_t depth) {
        skipWhitespace();
        if (eof()) {
            return fail(pos_, "unexpected end of input: expected a value");
        }
        const char c = peek();
        if (c == '{') {
            return parseObject(out, depth);
        }
        if (c == '[') {
            return parseArray(out, depth);
        }
        return parseScalar(out);
    }

    bool parseArray(Value& out, std::size_t depth) {
        if (depth > kMaxDepth) {
            return failDepth(pos_);
        }
        ++pos_;   // '['
        out = Value::array();

        skipWhitespace();
        if (eof()) {
            return fail(pos_, "unterminated array: expected ']'");
        }
        if (peek() == ']') {
            ++pos_;
            return true;
        }

        while (true) {
            // Parsed in place: an element parsed into a local and moved out
            // would double this frame's size, and the frame is multiplied by
            // the nesting depth.
            out.elements_.emplace_back();
            if (!parseValue(out.elements_.back(), depth + 1)) {
                return false;
            }
            skipWhitespace();
            if (eof()) {
                return fail(pos_, "unterminated array: expected ',' or ']'");
            }
            const char c = peek();
            if (c == ',') {
                ++pos_;
                skipWhitespace();
                if (!eof() && peek() == ']') {
                    return fail(pos_, "trailing comma before ']'");
                }
                continue;
            }
            if (c == ']') {
                ++pos_;
                return true;
            }
            return failFound(pos_, "expected ',' or ']' in array",
                             static_cast<unsigned char>(c));
        }
    }

    bool parseObject(Value& out, std::size_t depth) {
        if (depth > kMaxDepth) {
            return failDepth(pos_);
        }
        ++pos_;   // '{'
        out = Value::object();

        skipWhitespace();
        if (eof()) {
            return fail(pos_, "unterminated object: expected '}'");
        }
        if (peek() == '}') {
            ++pos_;
            return true;
        }

        while (true) {
            skipWhitespace();
            if (eof()) {
                return fail(pos_, "unterminated object: expected a member name");
            }
            if (peek() != '"') {
                return failFound(pos_, "expected a double-quoted member name",
                                 static_cast<unsigned char>(peek()));
            }
            // The key's buffer is scoped so it is released before the
            // recursive call below, rather than held across it at every level.
            {
                const std::size_t keyStart = pos_;
                std::string key;
                if (!parseString(key)) {
                    return false;
                }
                for (const std::pair<std::string, Value>& member : out.members_) {
                    if (member.first == key) {
                        return failDuplicate(keyStart, key);
                    }
                }

                skipWhitespace();
                if (eof() || peek() != ':') {
                    return failMissingColon(pos_, key);
                }
                ++pos_;

                out.members_.emplace_back(std::move(key), Value());
            }

            if (!parseValue(out.members_.back().second, depth + 1)) {
                return false;
            }

            skipWhitespace();
            if (eof()) {
                return fail(pos_, "unterminated object: expected ',' or '}'");
            }
            const char c = peek();
            if (c == ',') {
                ++pos_;
                skipWhitespace();
                if (!eof() && peek() == '}') {
                    return fail(pos_, "trailing comma before '}'");
                }
                continue;
            }
            if (c == '}') {
                ++pos_;
                return true;
            }
            return failFound(pos_, "expected ',' or '}' in object",
                             static_cast<unsigned char>(c));
        }
    }

    bool readHex4(std::uint32_t& out) {
        if (pos_ + 4 > text_.size()) {
            return fail(pos_, "\\u escape needs four hex digits");
        }
        std::uint32_t value = 0;
        for (int i = 0; i < 4; ++i) {
            const char c = text_[pos_ + static_cast<std::size_t>(i)];
            std::uint32_t digit = 0;
            if (c >= '0' && c <= '9') {
                digit = static_cast<std::uint32_t>(c - '0');
            } else if (c >= 'a' && c <= 'f') {
                digit = static_cast<std::uint32_t>(c - 'a') + 10;
            } else if (c >= 'A' && c <= 'F') {
                digit = static_cast<std::uint32_t>(c - 'A') + 10;
            } else {
                return fail(pos_ + static_cast<std::size_t>(i),
                            "\\u escape needs four hex digits");
            }
            value = (value << 4) | digit;
        }
        pos_ += 4;
        out = value;
        return true;
    }

    bool parseEscape(std::string& out) {
        const std::size_t escapeStart = pos_;
        ++pos_;   // '\'
        if (eof()) {
            return fail(escapeStart, "unterminated escape sequence");
        }
        const char c = peek();
        switch (c) {
        case '"':  out.push_back('"');  ++pos_; return true;
        case '\\': out.push_back('\\'); ++pos_; return true;
        case '/':  out.push_back('/');  ++pos_; return true;
        case 'b':  out.push_back('\b'); ++pos_; return true;
        case 'f':  out.push_back('\f'); ++pos_; return true;
        case 'n':  out.push_back('\n'); ++pos_; return true;
        case 'r':  out.push_back('\r'); ++pos_; return true;
        case 't':  out.push_back('\t'); ++pos_; return true;
        case 'u':
            break;
        default:
            return failUnknownEscape(escapeStart, static_cast<unsigned char>(c));
        }

        ++pos_;   // 'u'
        std::uint32_t first = 0;
        if (!readHex4(first)) {
            return false;
        }

        std::uint32_t codepoint = first;
        if (first >= 0xD800 && first <= 0xDBFF) {
            // A character outside the BMP is written as a surrogate pair; the
            // low half is not optional, because a lone surrogate has no UTF-8
            // encoding.
            if (pos_ + 1 >= text_.size() || text_[pos_] != '\\' || text_[pos_ + 1] != 'u') {
                return fail(escapeStart,
                            "high surrogate escape is not followed by a low surrogate");
            }
            pos_ += 2;
            std::uint32_t second = 0;
            if (!readHex4(second)) {
                return false;
            }
            if (second < 0xDC00 || second > 0xDFFF) {
                return fail(escapeStart,
                            "high surrogate escape is not followed by a low surrogate");
            }
            codepoint = 0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00);
        } else if (first >= 0xDC00 && first <= 0xDFFF) {
            return fail(escapeStart, "unpaired low surrogate escape");
        }

        appendUtf8(out, codepoint);
        return true;
    }

    bool parseString(std::string& out) {
        out.clear();
        ++pos_;   // opening '"'
        while (true) {
            if (eof()) {
                return fail(pos_, "unterminated string");
            }
            const unsigned char c = static_cast<unsigned char>(peek());
            if (c == '"') {
                ++pos_;
                return true;
            }
            if (c == '\\') {
                if (!parseEscape(out)) {
                    return false;
                }
                continue;
            }
            if (c < 0x20) {
                return failControlCharacter(pos_, c);
            }
            if (c < 0x80) {
                out.push_back(static_cast<char>(c));
                ++pos_;
                continue;
            }
            std::uint32_t codepoint = 0;
            const std::size_t length = decodeUtf8(text_, pos_, codepoint);
            if (length == 0) {
                return fail(pos_, "invalid UTF-8 sequence in string");
            }
            out.append(text_, pos_, length);
            pos_ += length;
        }
    }

    bool parseNumber(Value& out) {
        const std::size_t start = pos_;
        if (!eof() && peek() == '-') {
            ++pos_;
        }
        if (eof() || !isDigit(peek())) {
            if (eof()) {
                return fail(start, "expected a value but found end of input");
            }
            return failFound(start, "expected a value", static_cast<unsigned char>(text_[start]));
        }

        if (peek() == '0') {
            ++pos_;
            // "01" is not a JSON number, and accepting it invites the reader
            // and the writer to disagree about octal.
            if (!eof() && isDigit(peek())) {
                return fail(start, "number has a leading zero");
            }
        } else {
            while (!eof() && isDigit(peek())) {
                ++pos_;
            }
        }

        if (!eof() && peek() == '.') {
            ++pos_;
            if (eof() || !isDigit(peek())) {
                return fail(pos_, "number has no digits after the decimal point");
            }
            while (!eof() && isDigit(peek())) {
                ++pos_;
            }
        }

        if (!eof() && (peek() == 'e' || peek() == 'E')) {
            ++pos_;
            if (!eof() && (peek() == '+' || peek() == '-')) {
                ++pos_;
            }
            if (eof() || !isDigit(peek())) {
                return fail(pos_, "number has no digits in its exponent");
            }
            while (!eof() && isDigit(peek())) {
                ++pos_;
            }
        }

        double value = 0.0;
        if (!toDouble(text_.substr(start, pos_ - start), value)) {
            return fail(start, "number is out of range for a double");
        }
        out = Value(value);
        return true;
    }

    const std::string& text_;
    std::size_t pos_ = 0;
    std::string error_;
    std::size_t errorOffset_ = 0;
};

} // namespace detail

ParseResult parse(const std::string& text) {
    detail::Parser parser(text);
    return parser.run();
}

} // namespace json
