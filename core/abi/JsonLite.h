#pragma once

// A dependency-free JSON reader/writer, sized for the BufferX ABI boundary.
//
// Requests and responses cross the native/WASM boundary as JSON text, so this
// must compile unchanged for MSVC, clang, gcc, and wasm32-emscripten, and must
// not use exceptions as an error channel: parse() reports failure through
// ParseResult and every accessor takes a fallback. The implementation contains
// no `throw`, no `try`, and no call that throws on bad input (no std::sto*, no
// container ::at), so it also compiles under -fno-exceptions.
//
// It implements RFC 8259 with four deliberate restrictions, because it reads
// untrusted input and a permissive parser at a trust boundary is a liability:
//
//   * Nesting is capped at kMaxDepth so hostile input cannot exhaust the
//     stack. The parser recurses, and the cap is what bounds that recursion.
//   * Duplicate member names are rejected rather than resolved. Parsers that
//     silently pick the first or the last disagree with each other, and a
//     document that means two different things to two readers of the same
//     message is exactly the bug an ABI boundary must not have.
//   * Unpaired UTF-16 surrogate escapes are rejected rather than substituted,
//     since they cannot be represented in the UTF-8 this promises to emit.
//   * Numbers that overflow a double are rejected rather than becoming
//     infinity, which would serialize back out as invalid JSON. (Underflow to
//     zero is accepted, as it is a representable result.)
//
// Input must be UTF-8; a leading byte-order mark is skipped, and malformed
// UTF-8 inside a string is a parse error. Serialization is total: it escapes
// what must be escaped and substitutes U+FFFD for any invalid byte, so its
// output is always valid UTF-8 and always re-parses.
//
// Member order is preserved -- `Members` is a vector of pairs, not a map -- so
// a document re-serializes in the order it was read. Lookup and insertion scan
// linearly, which suits ABI-sized objects and not objects with thousands of
// members.
//
// Stack budget, which the embedder has to care about: the parser recurses once
// per level of nesting, so the cap and the available stack have to be chosen
// together. Measured on MSVC x64 at kMaxDepth = 256, worst case (nested
// objects): about 76 KB optimized and 112 KB unoptimized, i.e. 300-450 bytes
// per level. Emscripten's default -sSTACK_SIZE has historically been 64 KB,
// which is *not* enough: give it at least 256 KB, or lower kMaxDepth. Getting
// this wrong turns the depth cap from a defence into the thing that trips.

#include <cstddef>
#include <string>
#include <utility>
#include <vector>

namespace json {

class Value;
using Members = std::vector<std::pair<std::string, Value>>;   // insertion-ordered
using Array   = std::vector<Value>;

// The deepest chain of nested arrays/objects parse() will accept, and the
// depth past which serialize() stops descending (emitting null instead).
inline constexpr std::size_t kMaxDepth = 256;

namespace detail { class Parser; }

class Value {
public:
    enum class Type { Null, Bool, Number, String, Array, Object };

    Value();                       // null
    Value(bool v);
    Value(double v);
    Value(int v);
    Value(long long v);
    Value(const char* v);          // a null pointer yields a JSON null
    Value(std::string v);

    static Value array();
    static Value object();

    Type type() const;
    bool isNull() const;
    bool isBool() const;
    bool isNumber() const;
    bool isString() const;
    bool isArray() const;
    bool isObject() const;

    // Each returns `fallback` unless the value is of the matching type; no
    // coercion is performed, so asString() on a number is the fallback, not
    // "17". asInt() truncates toward zero and clamps to the int range.
    bool        asBool(bool fallback = false) const;
    double      asNumber(double fallback = 0.0) const;
    int         asInt(int fallback = 0) const;
    std::string asString(const std::string& fallback = {}) const;

    // Object access. find() returns nullptr when absent, which callers must
    // distinguish from a present-but-null member.
    const Value* find(const std::string& key) const;
    bool has(const std::string& key) const;
    // Replaces the value of an existing key in place, preserving its position;
    // otherwise appends. Turns a non-object into an empty object first, so
    // building up a value from null works without a cast.
    void set(std::string key, Value value);

    // Array access.
    void push(Value value);                     // turns a non-array into an array first
    std::size_t size() const;                   // elements, or members for an object; else 0
    const Value& at(std::size_t index) const;   // returns a static null if out of range

    std::string serialize() const;              // compact, no trailing whitespace

private:
    // The parser fills containers in place through this friendship rather than
    // parsing into a stack local and moving: it halves the stack cost of each
    // nesting level, which is what makes kMaxDepth affordable on wasm.
    friend class detail::Parser;

    // Serialization must walk object members in order, and the public API
    // deliberately exposes no member iterator.
    void writeTo(std::string& out, std::size_t depth) const;

    Type        type_ = Type::Null;
    bool        bool_ = false;
    double      number_ = 0.0;
    std::string string_;
    Array       elements_;
    Members     members_;
};

struct ParseResult {
    bool ok = false;
    std::string error;
    // Byte offset of the failure; on success, the number of bytes consumed.
    std::size_t offset = 0;
    Value value;
};

ParseResult parse(const std::string& text);

} // namespace json
