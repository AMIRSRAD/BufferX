// Verifies the dependency-free JSON reader/writer used at the ABI boundary:
// that every type survives a round trip byte-for-byte, that numbers come back
// as the same double they went in as, that hostile input is refused rather
// than half-accepted, and that nesting cannot run the stack off the end.
//
// Standalone: no test framework, no build wiring.
//   c++ -std=c++17 JsonLiteTest.cpp ../JsonLite.cpp -o JsonLiteTest

#include <cstddef>
#include <cstdio>
#include <limits>
#include <string>

#include "../JsonLite.h"

namespace {

int failures = 0;

void check(bool condition, const std::string& label, const std::string& detail = {}) {
    if (condition) {
        std::printf("  [PASS] %s\n", label.c_str());
        return;
    }
    ++failures;
    std::printf("  [FAIL] %s%s\n", label.c_str(),
                detail.empty() ? "" : ("  -> " + detail).c_str());
}

// Renders bytes readably, so a failure involving control characters, embedded
// NULs, or UTF-8 says what actually came back.
std::string show(const std::string& s) {
    std::string out;
    char buf[8];
    for (const char c : s) {
        const unsigned char b = static_cast<unsigned char>(c);
        if (b >= 0x20 && b < 0x7F) {
            out.push_back(static_cast<char>(b));
        } else {
            std::snprintf(buf, sizeof buf, "<%02X>", static_cast<unsigned>(b));
            out += buf;
        }
    }
    return out;
}

void checkEqual(const std::string& actual, const std::string& expected, const std::string& label) {
    check(actual == expected, label, "got " + show(actual) + ", want " + show(expected));
}

// Parses `text` and asserts that re-serializing it produces `expected`.
void checkRoundTrip(const std::string& text, const std::string& expected,
                    const std::string& label) {
    const json::ParseResult result = json::parse(text);
    if (!result.ok) {
        check(false, label, "parse failed: " + result.error + " at offset " +
                                std::to_string(result.offset));
        return;
    }
    checkEqual(result.value.serialize(), expected, label);
}

// Asserts that `text` is refused, and that the message says why.
void checkReject(const std::string& text, const std::string& needle, const std::string& label) {
    const json::ParseResult result = json::parse(text);
    if (result.ok) {
        check(false, label, "accepted \"" + show(text) + "\"; expected rejection");
        return;
    }
    const bool explained = result.error.find(needle) != std::string::npos;
    check(explained, label, "message was \"" + result.error + "\", expected it to mention \"" +
                                needle + "\"");
}

std::string repeat(const std::string& unit, std::size_t times) {
    std::string out;
    out.reserve(unit.size() * times);
    for (std::size_t i = 0; i < times; ++i) {
        out += unit;
    }
    return out;
}

} // namespace

int main() {
    std::printf("=== Scalars round-trip ===\n");
    checkRoundTrip("null", "null", "null");
    checkRoundTrip("true", "true", "true");
    checkRoundTrip("false", "false", "false");
    checkRoundTrip("17", "17", "integer");
    checkRoundTrip("-17", "-17", "negative integer");
    checkRoundTrip("\"text\"", "\"text\"", "string");
    checkRoundTrip("[]", "[]", "empty array");
    checkRoundTrip("{}", "{}", "empty object");
    checkRoundTrip("  \t\r\n  42  \n ", "42", "leading and trailing whitespace ignored");
    checkRoundTrip("\xEF\xBB\xBF" "42", "42", "leading byte-order mark skipped");

    {
        const json::ParseResult r = json::parse("null");
        check(r.ok && r.value.isNull(), "parsed null has type Null");
        check(r.value.type() == json::Value::Type::Null, "type() reports Null");
    }
    {
        const json::ParseResult r = json::parse("true");
        check(r.ok && r.value.isBool() && r.value.asBool(), "parsed true is a bool that is true");
        const json::ParseResult f = json::parse("false");
        check(f.ok && f.value.isBool() && !f.value.asBool(true),
              "parsed false is a bool that is false, not the fallback");
    }
    {
        const json::ParseResult r = json::parse("-3.5");
        check(r.ok && r.value.isNumber(), "parsed -3.5 is a number");
        check(r.value.asNumber() == -3.5, "asNumber returns -3.5");
        check(r.value.asInt() == -3, "asInt truncates toward zero");
    }
    {
        const json::ParseResult r = json::parse("\"abc\"");
        check(r.ok && r.value.isString(), "parsed \"abc\" is a string");
        checkEqual(r.value.asString(), "abc", "asString returns the decoded text");
    }

    std::printf("\n=== Constructors and accessor fallbacks ===\n");
    checkEqual(json::Value().serialize(), "null", "default-constructed value is null");
    checkEqual(json::Value(true).serialize(), "true", "Value(bool)");
    checkEqual(json::Value(42).serialize(), "42", "Value(int)");
    checkEqual(json::Value(-9007199254740992LL).serialize(), "-9007199254740992",
               "Value(long long) at 2^53");
    checkEqual(json::Value(42.0).serialize(), "42", "Value(double) that is integral");
    checkEqual(json::Value(2.5).serialize(), "2.5", "Value(double) that is not");
    checkEqual(json::Value("literal").serialize(), "\"literal\"",
               "Value(const char*) beats the bool overload");
    checkEqual(json::Value(std::string("owned")).serialize(), "\"owned\"", "Value(std::string)");
    check(json::Value(static_cast<const char*>(nullptr)).isNull(),
          "Value(const char*) with a null pointer is a JSON null");
    checkEqual(json::Value::array().serialize(), "[]", "Value::array() is empty");
    checkEqual(json::Value::object().serialize(), "{}", "Value::object() is empty");

    {
        const json::Value number(7);
        check(number.asBool(true), "asBool on a number returns the fallback");
        checkEqual(number.asString("fallback"), "fallback",
                   "asString on a number returns the fallback (no coercion)");
        const json::Value text("7");
        check(text.asNumber(-1.0) == -1.0, "asNumber on a string returns the fallback");
        check(text.asInt(-1) == -1, "asInt on a string returns the fallback");
        check(json::Value().asInt(99) == 99, "asInt on null returns the fallback");
        check(json::Value(1e300).asInt(0) == std::numeric_limits<int>::max(),
              "asInt clamps rather than casting out of range");
        check(json::Value(-1e300).asInt(0) == std::numeric_limits<int>::min(),
              "asInt clamps at the low end too");
    }

    std::printf("\n=== Objects: order, lookup, mutation ===\n");
    checkRoundTrip("{\"z\":1,\"m\":2,\"a\":3}", "{\"z\":1,\"m\":2,\"a\":3}",
                   "member order is preserved, not sorted");
    {
        json::Value o = json::Value::object();
        o.set("first", 1);
        o.set("second", json::Value("two"));
        o.set("third", true);
        o.set("second", 22);   // replace in place
        checkEqual(o.serialize(), "{\"first\":1,\"second\":22,\"third\":true}",
                   "set() replaces in place and keeps the original position");
        check(o.size() == 3, "size() counts members", std::to_string(o.size()));
    }
    {
        json::Value built;   // null, promoted by set()
        built.set("a", 1);
        checkEqual(built.serialize(), "{\"a\":1}", "set() promotes a null value to an object");
    }
    {
        const json::ParseResult r = json::parse("{\"present\":null}");
        check(r.ok, "object with a null member parses", r.error);
        check(r.value.find("present") != nullptr,
              "find() returns a pointer for a present-but-null member");
        check(r.value.find("present") != nullptr && r.value.find("present")->isNull(),
              "that member is null");
        check(r.value.find("absent") == nullptr, "find() returns nullptr for an absent member");
        check(r.value.has("present") && !r.value.has("absent"), "has() agrees with find()");
        check(json::Value(1).find("any") == nullptr, "find() on a non-object returns nullptr");
    }

    std::printf("\n=== Arrays ===\n");
    checkRoundTrip("[1,\"two\",true,null,[],{}]", "[1,\"two\",true,null,[],{}]",
                   "mixed array round-trips");
    {
        json::Value a = json::Value::array();
        a.push(1);
        a.push(json::Value("two"));
        a.push(json::Value());
        checkEqual(a.serialize(), "[1,\"two\",null]", "push() appends in order");
        check(a.size() == 3, "size() counts elements", std::to_string(a.size()));
        check(a.at(1).asString() == "two", "at() returns the element");
        check(a.at(99).isNull(), "at() past the end returns a null value");
        check(&a.at(99) == &a.at(100), "out-of-range at() returns the same static null");
        check(json::Value(1).at(0).isNull(), "at() on a non-container returns null");
    }
    {
        json::Value built;   // null, promoted by push()
        built.push(1);
        checkEqual(built.serialize(), "[1]", "push() promotes a null value to an array");
    }

    std::printf("\n=== Nesting ===\n");
    {
        const std::string document =
            "{\"id\":\"txn-1\",\"fields\":[{\"n\":2,\"v\":\"6037\"},{\"n\":3,\"v\":null}],"
            "\"meta\":{\"nested\":{\"deep\":[1,[2,[3,[]]]]}},\"ok\":true}";
        checkRoundTrip(document, document, "nested objects and arrays round-trip exactly");
        const json::ParseResult r = json::parse(document);
        check(r.ok, "nested document parses", r.error);
        const json::Value* fields = r.value.find("fields");
        check(fields != nullptr && fields->isArray() && fields->size() == 2,
              "navigated to a two-element array");
        if (fields != nullptr && fields->size() == 2) {
            check(fields->at(0).find("v") != nullptr && fields->at(0).find("v")->asString() == "6037",
                  "navigated into the first element");
            check(fields->at(1).find("v") != nullptr && fields->at(1).find("v")->isNull(),
                  "second element's member is present and null");
        }
    }

    std::printf("\n=== Unicode ===\n");
    {
        const json::ParseResult r = json::parse("\"\\u0041\\u00e9\\u0644\"");
        check(r.ok, "BMP escapes parse", r.error);
        checkEqual(r.value.asString(), "A\xC3\xA9\xD9\x84",
                   "\\u escapes decode to 1-, 2-, and 3-byte UTF-8");
        checkEqual(r.value.serialize(), "\"A\xC3\xA9\xD9\x84\"",
                   "serialization emits raw UTF-8, not re-escaped");
    }
    {
        const json::ParseResult r = json::parse("\"\\uD83D\\uDE00\"");
        check(r.ok, "surrogate pair parses", r.error);
        checkEqual(r.value.asString(), "\xF0\x9F\x98\x80",
                   "U+1F600 assembled from its surrogate pair");
        checkEqual(r.value.serialize(), "\"\xF0\x9F\x98\x80\"", "astral character re-serializes");
    }
    {
        const json::ParseResult r = json::parse("\"\\uD834\\uDD1E\"");
        check(r.ok && r.value.asString() == "\xF0\x9D\x84\x9E",
              "U+1D11E (the textbook surrogate pair) assembled");
    }
    checkRoundTrip("\"\xD8\xA8\xD8\xA7\xD9\x86\xDA\xA9\"", "\"\xD8\xA8\xD8\xA7\xD9\x86\xDA\xA9\"",
                   "raw multi-byte UTF-8 passes through unchanged");
    checkRoundTrip("\"\\u0000\"", "\"\\u0000\"", "NUL escapes and re-escapes");
    {
        const json::ParseResult r = json::parse("\"a\\u0000b\"");
        check(r.ok && r.value.asString().size() == 3, "embedded NUL is kept, not truncated",
              r.ok ? show(r.value.asString()) : r.error);
    }
    checkRoundTrip("\"\\\"\\\\\\/\\b\\f\\n\\r\\t\"", "\"\\\"\\\\/\\b\\f\\n\\r\\t\"",
                   "all short escapes decode; only '/' is emitted unescaped");
    {
        // Bytes that are not UTF-8 can reach a Value from legacy-encoded input;
        // the writer must still emit a document that parses.
        const json::Value bad(std::string("ok\xC3\x28" "end"));
        const std::string out = bad.serialize();
        checkEqual(out, "\"ok\xEF\xBF\xBD(end\"",
                   "invalid UTF-8 is replaced with U+FFFD on output");
        check(json::parse(out).ok, "sanitized output re-parses");
    }
    {
        const json::Value control(std::string("\x01\x1F"));
        checkEqual(control.serialize(), "\"\\u0001\\u001f\"",
                   "control characters are escaped on output");
    }

    std::printf("\n=== Number formatting ===\n");
    checkRoundTrip("17.0", "17", "17.0 is emitted as 17");
    checkRoundTrip("1e2", "100", "1e2 is emitted as 100");
    checkRoundTrip("-0.5", "-0.5", "negative fraction");
    checkRoundTrip("0", "0", "zero");
    checkRoundTrip("-0", "0", "negative zero normalizes to 0");
    checkRoundTrip("0.1", "0.1", "0.1 is not over-printed");
    checkRoundTrip("1e-7", "1e-07", "small magnitudes use an exponent");
    checkRoundTrip("9007199254740992", "9007199254740992", "2^53 survives as an integer");
    checkEqual(json::Value(0.1 + 0.2).serialize(), "0.30000000000000004",
               "17 significant digits are used when they are needed");
    {
        const double third = 1.0 / 3.0;
        const json::ParseResult r = json::parse(json::Value(third).serialize());
        check(r.ok && r.value.asNumber() == third, "1/3 round-trips bit-identically",
              r.ok ? json::Value(third).serialize() : r.error);
    }
    {
        const double big = 1.7976931348623157e308;   // DBL_MAX
        const json::ParseResult r = json::parse(json::Value(big).serialize());
        check(r.ok && r.value.asNumber() == big, "DBL_MAX round-trips",
              r.ok ? json::Value(big).serialize() : r.error);
    }
    {
        const json::ParseResult r = json::parse("1e-400");
        check(r.ok && r.value.asNumber() == 0.0, "underflow is accepted as zero",
              r.ok ? "" : r.error);
    }
    checkEqual(json::Value(std::numeric_limits<double>::infinity()).serialize(), "null",
               "infinity serializes as null rather than invalid JSON");
    checkEqual(json::Value(std::numeric_limits<double>::quiet_NaN()).serialize(), "null",
               "NaN serializes as null");
    check(json::Value(std::numeric_limits<double>::quiet_NaN()).asInt(-1) == -1,
          "asInt on NaN returns the fallback");

    std::printf("\n=== Malformed input is refused ===\n");
    checkReject("", "end of input", "empty input");
    checkReject("   ", "end of input", "whitespace-only input");
    checkReject("{", "unterminated object", "unterminated object");
    checkReject("[", "unterminated array", "unterminated array");
    checkReject("[1,2", "unterminated array", "array cut short after an element");
    checkReject("\"abc", "unterminated string", "unterminated string");
    checkReject("[1,]", "trailing comma", "trailing comma in an array");
    checkReject("{\"a\":1,}", "trailing comma", "trailing comma in an object");
    checkReject("{'a':1}", "member name", "single-quoted member name");
    checkReject("{a:1}", "member name", "unquoted member name");
    checkReject("{\"a\" 1}", "expected ':'", "missing colon");
    checkReject("{\"a\":1 \"b\":2}", "expected ',' or '}'", "missing comma between members");
    checkReject("[1 2]", "expected ',' or ']'", "missing comma between elements");
    checkReject("01", "leading zero", "leading zero");
    checkReject("-01", "leading zero", "leading zero after a sign");
    checkReject("1.", "after the decimal point", "trailing decimal point");
    checkReject(".5", "expected a value", "bare leading decimal point");
    checkReject("+1", "expected a value", "explicit plus sign");
    checkReject("1e", "exponent", "exponent with no digits");
    checkReject("1e+", "exponent", "exponent with a sign but no digits");
    checkReject("tru", "invalid literal", "truncated literal");
    checkReject("TRUE", "expected a value", "upper-case literal");
    checkReject("NaN", "expected a value", "NaN is not JSON");
    checkReject("Infinity", "expected a value", "Infinity is not JSON");
    checkReject("1e999", "out of range", "exponent overflowing a double");
    checkReject("\"\\x\"", "unknown escape", "unknown escape sequence");
    checkReject("\"\\u12\"", "four hex digits", "short \\u escape");
    checkReject("\"\\uZZZZ\"", "four hex digits", "non-hex \\u escape");
    checkReject("\"\\uD83D\"", "low surrogate", "lone high surrogate");
    checkReject("\"\\uD83Dx\"", "low surrogate", "high surrogate followed by a plain character");
    checkReject("\"\\uD83D\\u0041\"", "low surrogate", "high surrogate followed by a BMP escape");
    checkReject("\"\\uDE00\"", "unpaired low surrogate", "lone low surrogate");
    checkReject("\"raw\nnewline\"", "unescaped control character", "raw newline inside a string");
    checkReject("\"raw\ttab\"", "unescaped control character", "raw tab inside a string");
    checkReject("\"\xC3\x28\"", "invalid UTF-8", "invalid UTF-8 in a string");
    checkReject("\"\xED\xA0\x80\"", "invalid UTF-8", "surrogate encoded directly in UTF-8");
    checkReject("\"\xC0\xAF\"", "invalid UTF-8", "overlong UTF-8 encoding");
    checkReject("{\"a\":1,\"a\":2}", "duplicate member name", "duplicate member names");
    checkReject("1 2", "trailing content", "two top-level values");
    checkReject("{} {}", "trailing content", "two top-level objects");
    checkReject("[1] junk", "trailing content", "junk after the top-level value");
    checkReject("nullx", "trailing content", "literal followed by junk");

    std::printf("\n=== Error offsets ===\n");
    {
        const json::ParseResult r = json::parse("{\"a\": }");
        check(!r.ok && r.offset == 6, "offset points at the missing value",
              "ok=" + std::string(r.ok ? "true" : "false") + " offset=" +
                  std::to_string(r.offset));
    }
    {
        const json::ParseResult r = json::parse("[1, 2, ]");
        check(!r.ok && r.offset == 7, "offset points at the trailing comma's ']'",
              "offset=" + std::to_string(r.offset));
    }
    {
        const json::ParseResult r = json::parse("[0,1,2,3,4,5,6,7,8,9,x]");
        check(!r.ok && r.offset == 21, "offset survives twenty elements of context",
              "offset=" + std::to_string(r.offset));
    }
    {
        const json::ParseResult r = json::parse("[1,2,3");
        check(!r.ok && r.value.isNull(), "a failed parse yields a null value, not a partial one");
    }

    std::printf("\n=== Depth limiting ===\n");
    {
        const std::string atLimit = repeat("[", json::kMaxDepth) + repeat("]", json::kMaxDepth);
        const json::ParseResult r = json::parse(atLimit);
        check(r.ok, "arrays nested exactly kMaxDepth deep are accepted", r.error);
        if (r.ok) {
            checkEqual(r.value.serialize(), atLimit, "and serialize back to the same depth");
        }
    }
    {
        const std::string overLimit =
            repeat("[", json::kMaxDepth + 1) + repeat("]", json::kMaxDepth + 1);
        checkReject(overLimit, "maximum nesting depth", "one level too deep is refused");
    }
    {
        const std::string overLimit = repeat("{\"a\":", json::kMaxDepth + 1) + "1" +
                                      repeat("}", json::kMaxDepth + 1);
        checkReject(overLimit, "maximum nesting depth", "object nesting is capped the same way");
    }
    {
        // The point of the cap: input designed to exhaust the stack must come
        // back as an error, not a crash.
        const std::string hostile = repeat("[", 100000);
        const json::ParseResult r = json::parse(hostile);
        check(!r.ok && r.error.find("maximum nesting depth") != std::string::npos,
              "100k unclosed brackets are refused without recursing that far", r.error);
    }

    std::printf("\n=== RESULT: %s (%d failures) ===\n", failures == 0 ? "ALL PASS" : "FAILURES",
                failures);
    return failures == 0 ? 0 : 1;
}
