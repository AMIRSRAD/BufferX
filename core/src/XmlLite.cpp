#include "bufferx/XmlLite.h"

#include <cstdint>
#include <utility>

namespace xmllite {
namespace {

bool isNameStart(char c) {
    const unsigned char u = static_cast<unsigned char>(c);
    return (u >= 'a' && u <= 'z') || (u >= 'A' && u <= 'Z') || c == '_' || c == ':' || u >= 0x80;
}

bool isNameChar(char c) {
    const unsigned char u = static_cast<unsigned char>(c);
    return isNameStart(c) || (u >= '0' && u <= '9') || c == '-' || c == '.';
}

bool isSpace(char c) {
    return c == ' ' || c == '\t' || c == '\r' || c == '\n';
}

// Appends `cp` to `out` as UTF-8. Character references are the only place the
// parser produces codepoints rather than copying bytes through verbatim.
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

class Parser {
public:
    explicit Parser(std::string_view xml) : xml_(xml) {}

    ParseResult run() {
        ParseResult result;

        skipProlog();
        if (failed_) {
            return finish(result);
        }

        if (eof()) {
            return fail(result, "document contains no root element");
        }
        if (peek() != '<') {
            return fail(result, "expected '<' at start of root element");
        }

        Element root;
        if (!parseElement(root)) {
            return finish(result);
        }

        // Trailing comments and processing instructions are legal after the root.
        skipMisc();
        if (failed_) {
            return finish(result);
        }
        if (!eof()) {
            return fail(result, "unexpected content after root element");
        }

        result.ok = true;
        result.root = std::move(root);
        return result;
    }

private:
    std::string_view xml_;
    std::size_t pos_ = 0;
    std::size_t line_ = 1;
    std::size_t column_ = 1;
    bool failed_ = false;
    std::string error_;
    std::size_t errorLine_ = 0;
    std::size_t errorColumn_ = 0;

    bool eof() const { return pos_ >= xml_.size(); }
    char peek() const { return xml_[pos_]; }

    char get() {
        const char c = xml_[pos_++];
        if (c == '\n') {
            ++line_;
            column_ = 1;
        } else {
            ++column_;
        }
        return c;
    }

    bool startsWith(std::string_view needle) const {
        return xml_.substr(pos_).rfind(needle, 0) == 0;
    }

    void advance(std::size_t count) {
        for (std::size_t i = 0; i < count && !eof(); ++i) {
            get();
        }
    }

    bool error(std::string message) {
        if (!failed_) {
            failed_ = true;
            error_ = std::move(message);
            errorLine_ = line_;
            errorColumn_ = column_;
        }
        return false;
    }

    ParseResult& fail(ParseResult& result, std::string message) {
        error(std::move(message));
        return finish(result);
    }

    ParseResult& finish(ParseResult& result) {
        result.ok = false;
        result.error = error_.empty() ? "unknown parse error" : error_;
        result.line = errorLine_;
        result.column = errorColumn_;
        return result;
    }

    void skipSpace() {
        while (!eof() && isSpace(peek())) {
            get();
        }
    }

    // Skips comments, processing instructions, and DOCTYPE declarations.
    void skipMisc() {
        for (;;) {
            skipSpace();
            if (eof() || failed_) {
                return;
            }
            if (startsWith("<!--")) {
                advance(4);
                while (!eof() && !startsWith("-->")) {
                    get();
                }
                if (eof()) {
                    error("unterminated comment");
                    return;
                }
                advance(3);
            } else if (startsWith("<?")) {
                advance(2);
                while (!eof() && !startsWith("?>")) {
                    get();
                }
                if (eof()) {
                    error("unterminated processing instruction");
                    return;
                }
                advance(2);
            } else if (startsWith("<!DOCTYPE")) {
                advance(9);
                int depth = 1;
                while (!eof() && depth > 0) {
                    const char c = get();
                    if (c == '<') {
                        ++depth;
                    } else if (c == '>') {
                        --depth;
                    }
                }
                if (depth != 0) {
                    error("unterminated DOCTYPE declaration");
                    return;
                }
            } else {
                return;
            }
        }
    }

    void skipProlog() { skipMisc(); }

    std::string parseName() {
        std::string name;
        if (eof() || !isNameStart(peek())) {
            error("expected element or attribute name");
            return name;
        }
        while (!eof() && isNameChar(peek())) {
            name.push_back(get());
        }
        return name;
    }

    // Resolves the five predefined entities plus numeric character references.
    // Unknown entities are an error rather than being silently passed through,
    // so a malformed packager file fails loudly instead of decoding wrongly.
    bool parseReference(std::string& out) {
        get(); // consume '&'
        std::string name;
        while (!eof() && peek() != ';' && !isSpace(peek()) && peek() != '<' && name.size() < 32) {
            name.push_back(get());
        }
        if (eof() || peek() != ';') {
            return error("unterminated entity reference");
        }
        get(); // consume ';'

        if (name == "lt") {
            out.push_back('<');
        } else if (name == "gt") {
            out.push_back('>');
        } else if (name == "amp") {
            out.push_back('&');
        } else if (name == "apos") {
            out.push_back('\'');
        } else if (name == "quot") {
            out.push_back('"');
        } else if (name.size() >= 2 && name[0] == '#') {
            std::uint32_t cp = 0;
            const bool hex = name[1] == 'x' || name[1] == 'X';
            const std::size_t start = hex ? 2 : 1;
            if (start >= name.size()) {
                return error("malformed character reference");
            }
            for (std::size_t i = start; i < name.size(); ++i) {
                const char c = name[i];
                std::uint32_t digit = 0;
                if (c >= '0' && c <= '9') {
                    digit = static_cast<std::uint32_t>(c - '0');
                } else if (hex && c >= 'a' && c <= 'f') {
                    digit = static_cast<std::uint32_t>(c - 'a' + 10);
                } else if (hex && c >= 'A' && c <= 'F') {
                    digit = static_cast<std::uint32_t>(c - 'A' + 10);
                } else {
                    return error("malformed character reference");
                }
                cp = cp * (hex ? 16u : 10u) + digit;
                if (cp > 0x10FFFF) {
                    return error("character reference out of range");
                }
            }
            appendUtf8(out, cp);
        } else {
            return error("unsupported entity reference '&" + name + ";'");
        }
        return true;
    }

    bool parseAttributeValue(std::string& value) {
        if (eof() || (peek() != '"' && peek() != '\'')) {
            return error("expected quoted attribute value");
        }
        const char quote = get();
        while (!eof() && peek() != quote) {
            if (peek() == '&') {
                if (!parseReference(value)) {
                    return false;
                }
            } else if (peek() == '<') {
                return error("'<' is not allowed in an attribute value");
            } else {
                // Attribute-value normalization: literal newlines and tabs
                // become spaces, per the XML specification.
                const char c = get();
                value.push_back(isSpace(c) ? ' ' : c);
            }
        }
        if (eof()) {
            return error("unterminated attribute value");
        }
        get(); // closing quote
        return true;
    }

    bool parseElement(Element& element) {
        get(); // consume '<'
        element.name = parseName();
        if (failed_) {
            return false;
        }

        for (;;) {
            skipSpace();
            if (eof()) {
                return error("unterminated start tag for element '" + element.name + "'");
            }
            if (peek() == '/') {
                get();
                if (eof() || peek() != '>') {
                    return error("malformed self-closing tag for element '" + element.name + "'");
                }
                get();
                return true; // self-closing: no children, no text
            }
            if (peek() == '>') {
                get();
                break;
            }

            Attribute attribute;
            attribute.name = parseName();
            if (failed_) {
                return false;
            }
            // Whitespace is permitted on both sides of '=' and appears in real
            // packager files (e.g. `Flags ="00"`).
            skipSpace();
            if (eof() || peek() != '=') {
                return error("expected '=' after attribute '" + attribute.name + "'");
            }
            get();
            skipSpace();
            if (!parseAttributeValue(attribute.value)) {
                return false;
            }
            element.attributes.push_back(std::move(attribute));
        }

        return parseContent(element);
    }

    bool parseContent(Element& element) {
        for (;;) {
            if (eof()) {
                return error("unterminated element '" + element.name + "'");
            }

            if (startsWith("</")) {
                advance(2);
                const std::string closing = parseName();
                if (failed_) {
                    return false;
                }
                if (closing != element.name) {
                    return error("closing tag '" + closing + "' does not match '" + element.name + "'");
                }
                skipSpace();
                if (eof() || peek() != '>') {
                    return error("malformed closing tag for element '" + element.name + "'");
                }
                get();
                return true;
            }

            if (startsWith("<!--")) {
                advance(4);
                while (!eof() && !startsWith("-->")) {
                    get();
                }
                if (eof()) {
                    return error("unterminated comment");
                }
                advance(3);
                continue;
            }

            if (startsWith("<![CDATA[")) {
                advance(9);
                while (!eof() && !startsWith("]]>")) {
                    element.text.push_back(get());
                }
                if (eof()) {
                    return error("unterminated CDATA section");
                }
                advance(3);
                continue;
            }

            if (startsWith("<?")) {
                advance(2);
                while (!eof() && !startsWith("?>")) {
                    get();
                }
                if (eof()) {
                    return error("unterminated processing instruction");
                }
                advance(2);
                continue;
            }

            if (peek() == '<') {
                Element child;
                if (!parseElement(child)) {
                    return false;
                }
                element.children.push_back(std::move(child));
                continue;
            }

            if (peek() == '&') {
                if (!parseReference(element.text)) {
                    return false;
                }
                continue;
            }

            element.text.push_back(get());
        }
    }
};

} // namespace

const std::string* Element::attribute(std::string_view key) const {
    for (const Attribute& attribute : attributes) {
        if (attribute.name == key) {
            return &attribute.value;
        }
    }
    return nullptr;
}

bool Element::hasAttribute(std::string_view key) const {
    return attribute(key) != nullptr;
}

std::string Element::attributeOr(std::string_view key, std::string fallback) const {
    const std::string* found = attribute(key);
    return found != nullptr ? *found : std::move(fallback);
}

std::vector<const Element*> Element::childrenNamed(std::string_view wanted) const {
    std::vector<const Element*> matches;
    for (const Element& child : children) {
        if (child.name == wanted) {
            matches.push_back(&child);
        }
    }
    return matches;
}

ParseResult parse(std::string_view xml) {
    // Tolerate a UTF-8 byte order mark; Windows editors add one routinely.
    if (xml.size() >= 3 && static_cast<unsigned char>(xml[0]) == 0xEF &&
        static_cast<unsigned char>(xml[1]) == 0xBB && static_cast<unsigned char>(xml[2]) == 0xBF) {
        xml.remove_prefix(3);
    }
    return Parser(xml).run();
}

std::string escape(std::string_view text) {
    std::string out;
    out.reserve(text.size());
    for (const char c : text) {
        switch (c) {
        case '<': out += "&lt;"; break;
        case '>': out += "&gt;"; break;
        case '&': out += "&amp;"; break;
        case '"': out += "&quot;"; break;
        case '\'': out += "&apos;"; break;
        default: out.push_back(c); break;
        }
    }
    return out;
}

} // namespace xmllite
