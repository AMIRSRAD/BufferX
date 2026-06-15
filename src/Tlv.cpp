#include "Tlv.h"

#include <algorithm>
#include <cctype>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <unordered_map>

namespace tlvtool {

namespace {

const std::unordered_map<std::string, std::string> kTagDescriptions = {
    {"71/62/81", "Terminal batch number"},
    {"71/61/8C", "Reason code"},
    {"71/6F/89", "Display language code"},
    {"71/65/83", "Card CVV2"},
    {"71/6B/81", "Terminal firmware version (A.B.C.D)"},
    {"71/68/86", "Switch trace code"},
    {"71/6F/87", "Destination card PAN"},
    {"71/64", "Billing information"},
    {"71/64/88", "Billing entry index"},
    {"71/64/82", "Billing entry date"},
    {"71/64/85", "Billing amount #1"},
    {"71/64/86", "Billing amount #2"},
    {"71/64/89", "Billing amount #3"},
    {"71/64/87", "Charge-back flag"},
    {"71/68/99", "ACK confirmation method"},
    {"71/63/81", "New PIN block"},
    {"71/6F/84", "Card status"},
    {"71/65/82", "Customer profile"},
};

size_t parseTag(const std::vector<uint8_t>& buffer, size_t pos, std::vector<uint8_t>& tag) {
    if (pos >= buffer.size()) {
        throw std::runtime_error("TLV: unexpected end while reading tag");
    }

    tag.push_back(buffer[pos++]);
    if ((tag[0] & 0x1F) == 0x1F) {
        do {
            if (pos >= buffer.size()) {
                throw std::runtime_error("TLV: truncated long tag");
            }
            const uint8_t byte = buffer[pos++];
            tag.push_back(byte);
        } while ((tag.back() & 0x80u) != 0);
    }
    return pos;
}

size_t parseLength(const std::vector<uint8_t>& buffer, size_t pos, size_t& length) {
    if (pos >= buffer.size()) {
        throw std::runtime_error("TLV: unexpected end while reading length");
    }

    const uint8_t first = buffer[pos++];
    if ((first & 0x80u) == 0) {
        length = first;
        return pos;
    }

    const size_t numBytes = first & 0x7Fu;
    if (numBytes == 0 || numBytes > 3) {
        throw std::runtime_error("TLV: unsupported length octets");
    }
    if (pos + numBytes > buffer.size()) {
        throw std::runtime_error("TLV: truncated length field");
    }

    length = 0;
    for (size_t i = 0; i < numBytes; ++i) {
        length = (length << 8) | buffer[pos++];
    }
    return pos;
}

std::vector<Node> parseRecursive(const std::vector<uint8_t>& buffer, size_t& pos, size_t end) {
    std::vector<Node> nodes;
    while (pos < end) {
        Node node;
        pos = parseTag(buffer, pos, node.tag);

        size_t length = 0;
        pos = parseLength(buffer, pos, length);
        if (pos + length > buffer.size()) {
            throw std::runtime_error("TLV: length exceeds buffer size");
        }

        if (node.isComposite()) {
            const size_t childEnd = pos + length;
            node.children = parseRecursive(buffer, pos, childEnd);
        } else {
            node.value.assign(buffer.begin() + static_cast<std::ptrdiff_t>(pos),
                              buffer.begin() + static_cast<std::ptrdiff_t>(pos + length));
            pos += length;
        }
        nodes.push_back(std::move(node));
    }

    if (pos != end) {
        throw std::runtime_error("TLV: overrun when parsing nested TLV");
    }
    return nodes;
}

void appendTreeLine(const Node& node, int depth, std::ostringstream& out) {
    const std::string indent(static_cast<size_t>(depth * 2), ' ');
    size_t payloadLength = node.isComposite() ? 0 : node.value.size();
    if (node.isComposite()) {
        for (const Node& child : node.children) {
            payloadLength += child.encode().size();
        }
    }

    out << indent << "Tag=" << toHex(node.tag, ' ') << "  L=" << payloadLength;
    if (node.isComposite()) {
        out << "  [Composite, " << node.children.size() << " child]\n";
        for (const Node& child : node.children) {
            appendTreeLine(child, depth + 1, out);
        }
    } else {
        out << "  Value=" << toHex(node.value, ' ') << '\n';
    }
}

void flattenRecursive(const Node& node, const std::string& prefix, std::vector<FlatEntry>& entries) {
    const std::string tagText = toHex(node.tag, '/');
    const std::string path = prefix.empty() ? tagText : (prefix + '/' + tagText);
    if (node.isComposite()) {
        for (const Node& child : node.children) {
            flattenRecursive(child, path, entries);
        }
        return;
    }

    entries.push_back(FlatEntry{path, describePath(path), node.tag, node.value});
}

} // namespace

bool Node::isComposite() const {
    return !tag.empty() && ((tag[0] & 0x20u) != 0);
}

std::vector<uint8_t> Node::encode() const {
    std::vector<uint8_t> encoded(tag.begin(), tag.end());
    std::vector<uint8_t> payload;

    if (isComposite()) {
        for (const Node& child : children) {
            const std::vector<uint8_t> childEncoded = child.encode();
            payload.insert(payload.end(), childEncoded.begin(), childEncoded.end());
        }
    } else {
        payload = value;
    }

    if (payload.size() < 0x80) {
        encoded.push_back(static_cast<uint8_t>(payload.size()));
    } else {
        std::vector<uint8_t> lengthBytes;
        size_t copy = payload.size();
        while (copy != 0) {
            lengthBytes.push_back(static_cast<uint8_t>(copy & 0xFF));
            copy >>= 8;
        }
        std::reverse(lengthBytes.begin(), lengthBytes.end());
        encoded.push_back(static_cast<uint8_t>(0x80 | lengthBytes.size()));
        encoded.insert(encoded.end(), lengthBytes.begin(), lengthBytes.end());
    }

    encoded.insert(encoded.end(), payload.begin(), payload.end());
    return encoded;
}

std::vector<Node> parse(const std::vector<uint8_t>& buffer) {
    size_t pos = 0;
    return parseRecursive(buffer, pos, buffer.size());
}

std::string toHex(const std::vector<uint8_t>& bytes, char sep) {
    std::ostringstream out;
    out << std::uppercase << std::hex << std::setfill('0');
    for (size_t i = 0; i < bytes.size(); ++i) {
        out << std::setw(2) << static_cast<int>(bytes[i]);
        if (sep != 0 && i + 1 != bytes.size()) {
            out << sep;
        }
    }
    return out.str();
}

std::string toAsciiDebug(const std::vector<uint8_t>& bytes) {
    std::ostringstream out;
    out << std::uppercase << std::hex << std::setfill('0');
    for (uint8_t byte : bytes) {
        if (std::isprint(byte) != 0) {
            out << static_cast<char>(byte);
        } else {
            out << "\\x" << std::setw(2) << static_cast<int>(byte);
        }
    }
    return out.str();
}

std::string describePath(const std::string& path) {
    const auto it = kTagDescriptions.find(path);
    return it == kTagDescriptions.end() ? std::string() : it->second;
}

std::string buildTreeText(const std::vector<Node>& nodes) {
    std::ostringstream out;
    for (const Node& node : nodes) {
        appendTreeLine(node, 0, out);
    }
    return out.str();
}

std::vector<FlatEntry> flatten(const std::vector<Node>& nodes) {
    std::vector<FlatEntry> entries;
    for (const Node& node : nodes) {
        flattenRecursive(node, "", entries);
    }
    return entries;
}

std::string buildInlineText(const std::vector<Node>& nodes) {
    std::ostringstream out;
    const std::vector<FlatEntry> entries = flatten(nodes);
    for (const FlatEntry& entry : entries) {
        out << std::left << std::setw(25) << entry.path
            << "L=" << std::setw(3) << entry.value.size()
            << " V=" << toHex(entry.value, ' ')
            << "  [" << toAsciiDebug(entry.value) << ']';
        if (!entry.description.empty()) {
            out << "  -- " << entry.description;
        }
        out << '\n';
    }
    return out.str();
}

} // namespace tlvtool
