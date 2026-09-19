#pragma once

// A dependency-free XML reader, sized for BufferX packager definitions.
//
// This exists to remove the last Qt dependency from the domain core so it can
// target WebAssembly. It deliberately supports only the subset of XML that
// configuration documents use: elements, attributes, text, comments, CDATA,
// the standard five entities, and numeric character references. Namespaces,
// DTD validation, and external entities are not supported -- external entity
// expansion is a well-known attack surface and is intentionally absent.

#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

namespace xmllite {

struct Attribute {
    std::string name;
    std::string value;
};

struct Element {
    std::string name;
    std::vector<Attribute> attributes;
    std::vector<Element> children;
    std::string text;

    // Returns nullptr when the attribute is absent, which callers must
    // distinguish from an attribute that is present but empty.
    const std::string* attribute(std::string_view key) const;
    bool hasAttribute(std::string_view key) const;

    // Convenience accessors used by the packager loader.
    std::string attributeOr(std::string_view key, std::string fallback = {}) const;
    std::vector<const Element*> childrenNamed(std::string_view name) const;
};

struct ParseResult {
    bool ok = false;
    std::string error;
    std::size_t line = 0;
    std::size_t column = 0;
    Element root;
};

// Parses a complete XML document. On failure `ok` is false and `error`,
// `line`, and `column` describe the first problem encountered.
ParseResult parse(std::string_view xml);

// Escapes text for safe inclusion in XML character data or an attribute value.
std::string escape(std::string_view text);

} // namespace xmllite
