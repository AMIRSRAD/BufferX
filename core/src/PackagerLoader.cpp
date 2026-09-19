#include "bufferx/PackagerLoader.h"

#include "bufferx/XmlLite.h"

#include <string_view>
#include <utility>

namespace {

std::string trimmed(std::string_view value) {
    const auto isSpace = [](char c) {
        return c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '\f' || c == '\v';
    };
    std::size_t begin = 0;
    std::size_t end = value.size();
    while (begin < end && isSpace(value[begin])) {
        ++begin;
    }
    while (end > begin && isSpace(value[end - 1])) {
        --end;
    }
    return std::string(value.substr(begin, end - begin));
}

std::string contextPrefix(const std::string& context) {
    if (context.empty()) {
        return {};
    }
    return context + ": ";
}

// Strict integer parse matching the previous QString::toInt behaviour: an
// optional sign followed by digits and nothing else. Trailing garbage is an
// error rather than being silently truncated, because a malformed field length
// would otherwise corrupt every decode against that packager.
bool parseInt(const std::string& text, int& out) {
    if (text.empty()) {
        return false;
    }
    std::size_t index = 0;
    bool negative = false;
    if (text[0] == '+' || text[0] == '-') {
        negative = text[0] == '-';
        index = 1;
        if (text.size() == 1) {
            return false;
        }
    }
    long long value = 0;
    for (; index < text.size(); ++index) {
        const char c = text[index];
        if (c < '0' || c > '9') {
            return false;
        }
        value = value * 10 + (c - '0');
        if (value > 2147483647LL + (negative ? 1 : 0)) {
            return false;
        }
    }
    out = static_cast<int>(negative ? -value : value);
    return true;
}

bool readIntAttribute(const xmllite::Element& element,
                      const char* key,
                      int fallback,
                      int& out,
                      std::string& error,
                      const std::string& context) {
    const std::string* raw = element.attribute(key);
    if (raw == nullptr) {
        out = fallback;
        return true;
    }
    if (!parseInt(trimmed(*raw), out)) {
        error = contextPrefix(context) + "invalid integer value for attribute '" + key + "'.";
        return false;
    }
    return true;
}

bool readRequiredIntAttribute(const xmllite::Element& element,
                              const char* key,
                              int& out,
                              std::string& error,
                              const std::string& context) {
    const std::string* raw = element.attribute(key);
    if (raw == nullptr || trimmed(*raw).empty()) {
        error = contextPrefix(context) + "missing required attribute '" + key + "'.";
        return false;
    }
    return readIntAttribute(element, key, 0, out, error, context);
}

std::string readStringAttribute(const xmllite::Element& element, const char* key) {
    const std::string* raw = element.attribute(key);
    return raw == nullptr ? std::string() : trimmed(*raw);
}

bool readRequiredStringAttribute(const xmllite::Element& element,
                                 const char* key,
                                 std::string& out,
                                 std::string& error,
                                 const std::string& context) {
    const std::string* raw = element.attribute(key);
    if (raw == nullptr) {
        error = contextPrefix(context) + "missing required attribute '" + key + "'.";
        return false;
    }
    std::string value = trimmed(*raw);
    if (value.empty()) {
        error = contextPrefix(context) + "missing required attribute '" + key + "'.";
        return false;
    }
    out = std::move(value);
    return true;
}

// The previous reader matched <Packager> elements at any depth rather than only
// directly under the document root, so definitions could be grouped inside
// wrapper elements. That tolerance is preserved here.
void collectPackagerElements(const xmllite::Element& element,
                             std::vector<const xmllite::Element*>& out) {
    if (element.name == "Packager") {
        out.push_back(&element);
        return;
    }
    for (const xmllite::Element& child : element.children) {
        collectPackagerElements(child, out);
    }
}

bool loadFields(const xmllite::Element& packagerElement, Packager& pack, std::string& error) {
    for (const xmllite::Element& child : packagerElement.children) {
        if (child.name != "Field") {
            continue;
        }

        FieldDef def;
        if (!readRequiredIntAttribute(child,
                                      "FieldId",
                                      def.id,
                                      error,
                                      "Packager '" + pack.name + "' field")) {
            return false;
        }
        if (!readIntAttribute(child,
                              "FieldLength",
                              0,
                              def.length,
                              error,
                              "Packager '" + pack.name + "' field " + std::to_string(def.id))) {
            return false;
        }

        def.sourceType = readStringAttribute(child, "FieldType");
        def.type = parseFieldType(def.sourceType);
        def.desc = readStringAttribute(child, "FieldDesc");
        def.flags = readStringAttribute(child, "Flags");
        def.lengthDigits = lengthDigitsForFieldType(def.type);
        def.variable = isVariableLength(def.type);
        pack.fields[def.id] = def;
    }
    return true;
}

} // namespace

PackagerLoadResult PackagerLoader::loadFromXml(const std::string& xml) {
    PackagerLoadResult result;

    const xmllite::ParseResult parsed = xmllite::parse(xml);
    if (!parsed.ok) {
        result.ok = false;
        result.error = "XML parse error at line " + std::to_string(parsed.line) + ", column " +
                       std::to_string(parsed.column) + ": " + parsed.error;
        return result;
    }

    std::vector<const xmllite::Element*> packagerElements;
    collectPackagerElements(parsed.root, packagerElements);

    for (const xmllite::Element* element : packagerElements) {
        Packager pack;
        std::string error;

        if (!readRequiredStringAttribute(*element, "Name", pack.name, error, "Packager")) {
            result.error = error;
            return result;
        }

        pack.macMethod = readStringAttribute(*element, "MacMethod");
        pack.lenFormat = readStringAttribute(*element, "LenFormat");

        const std::string context = "Packager '" + pack.name + "'";
        if (!readIntAttribute(*element, "MacSize", 0, pack.macSize, error, context) ||
            !readIntAttribute(*element, "BitmapIndex", 1, pack.bitmapIndex, error, context) ||
            !readIntAttribute(*element, "SecondPartBitmap", 64, pack.secondPartBitmap, error, context) ||
            !readIntAttribute(*element, "FieldCount", 64, pack.fieldCount, error, context) ||
            !readIntAttribute(*element, "LenLen", 0, pack.lenLen, error, context)) {
            result.error = error;
            return result;
        }

        if (!loadFields(*element, pack, error)) {
            result.error = error;
            return result;
        }

        result.packagers.push_back(std::move(pack));
    }

    if (result.packagers.empty()) {
        result.ok = false;
        result.error = "No packagers found in XML.";
        return result;
    }

    result.ok = true;
    return result;
}
