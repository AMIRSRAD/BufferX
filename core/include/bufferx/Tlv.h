#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace tlvtool {

struct Node {
    std::vector<uint8_t> tag;
    std::vector<uint8_t> value;
    std::vector<Node> children;

    bool isComposite() const;
    std::vector<uint8_t> encode() const;
};

struct FlatEntry {
    std::string path;
    std::string description;
    std::vector<uint8_t> tag;
    std::vector<uint8_t> value;
};

std::vector<Node> parse(const std::vector<uint8_t>& buffer);
std::string toHex(const std::vector<uint8_t>& bytes, char sep = ' ');
std::string toAsciiDebug(const std::vector<uint8_t>& bytes);
std::string describePath(const std::string& path);
std::string buildTreeText(const std::vector<Node>& nodes);
std::vector<FlatEntry> flatten(const std::vector<Node>& nodes);
std::string buildInlineText(const std::vector<Node>& nodes);

} // namespace tlvtool
