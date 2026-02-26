#include "PackagerLoader.h"

#include <regex>
#include <unordered_map>

namespace {
std::unordered_map<std::string, std::string> parseAttributes(const std::string& tag) {
    std::unordered_map<std::string, std::string> attrs;
    static const std::regex attrRe(R"((\w+)\s*=\s*\"([^\"]*)\")");
    auto begin = std::sregex_iterator(tag.begin(), tag.end(), attrRe);
    auto end = std::sregex_iterator();
    for (auto it = begin; it != end; ++it) {
        attrs[it->str(1)] = it->str(2);
    }
    return attrs;
}

int readIntAttr(const std::unordered_map<std::string, std::string>& attrs,
                const std::string& key,
                int fallback) {
    auto it = attrs.find(key);
    if (it == attrs.end()) {
        return fallback;
    }
    try {
        return std::stoi(it->second);
    } catch (...) {
        return fallback;
    }
}

std::string readStrAttr(const std::unordered_map<std::string, std::string>& attrs,
                        const std::string& key) {
    auto it = attrs.find(key);
    if (it == attrs.end()) {
        return {};
    }
    return it->second;
}

} // namespace

PackagerLoadResult PackagerLoader::loadFromXml(const std::string& xml) {
    PackagerLoadResult result;
    static const std::regex packagerRe(
        R"(<\s*Packager\b([^>]*)>([\s\S]*?)</\s*Packager\s*>)",
        std::regex::icase);
    static const std::regex fieldRe(
        R"(<\s*Field\b([^>]*)/?>)",
        std::regex::icase);

    auto begin = std::sregex_iterator(xml.begin(), xml.end(), packagerRe);
    auto end = std::sregex_iterator();
    for (auto it = begin; it != end; ++it) {
        Packager pack;
        const std::string packagerTag = it->str(1);
        const std::string body = it->str(2);
        auto attrs = parseAttributes(packagerTag);

        pack.name = readStrAttr(attrs, "Name");
        pack.macMethod = readStrAttr(attrs, "MacMethod");
        pack.macSize = readIntAttr(attrs, "MacSize", 0);
        pack.bitmapIndex = readIntAttr(attrs, "BitmapIndex", 1);
        pack.secondPartBitmap = readIntAttr(attrs, "SecondPartBitmap", 64);
        pack.fieldCount = readIntAttr(attrs, "FieldCount", 64);
        pack.lenFormat = readStrAttr(attrs, "LenFormat");
        pack.lenLen = readIntAttr(attrs, "LenLen", 0);

        auto fieldBegin = std::sregex_iterator(body.begin(), body.end(), fieldRe);
        auto fieldEnd = std::sregex_iterator();
        for (auto fit = fieldBegin; fit != fieldEnd; ++fit) {
            const std::string fieldTag = fit->str(1);
            auto fattrs = parseAttributes(fieldTag);
            const int fieldId = readIntAttr(fattrs, "FieldId", -1);
            if (fieldId < 0) {
                continue;
            }

            FieldDef def;
            def.id = fieldId;
            def.type = parseFieldType(readStrAttr(fattrs, "FieldType"));
            def.length = readIntAttr(fattrs, "FieldLength", 0);
            def.desc = readStrAttr(fattrs, "FieldDesc");
            def.flags = readStrAttr(fattrs, "Flags");
            def.lengthDigits = lengthDigitsForFieldType(def.type);
            def.variable = isVariableLength(def.type);
            pack.fields[def.id] = def;
        }

        if (!pack.name.empty()) {
            result.packagers.push_back(std::move(pack));
        }
    }

    if (result.packagers.empty()) {
        result.ok = false;
        result.error = "No packagers found in XML.";
        return result;
    }

    result.ok = true;
    return result;
}
