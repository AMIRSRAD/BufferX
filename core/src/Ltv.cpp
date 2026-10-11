#include "bufferx/Ltv.h"
#include <utility>

namespace ltvtool {
namespace {
bool valid(const Options& options) { return options.lengthBytes >= 1 && options.lengthBytes <= 4 && options.tagBytes >= 1 && options.tagBytes <= 4; }
}
ParseResult parse(const std::vector<uint8_t>& bytes, const Options& options) {
    ParseResult result;
    if (!valid(options)) { result.error = "Length and tag widths must be between 1 and 4 bytes."; return result; }
    std::size_t offset = 0;
    const std::size_t header = options.lengthBytes + options.tagBytes;
    while (offset < bytes.size()) {
        const std::size_t start = offset;
        if (bytes.size() - offset < header) { result.error = "Incomplete LTV header at byte offset " + std::to_string(offset) + "."; return result; }
        uint64_t length = 0;
        for (unsigned i = 0; i < options.lengthBytes; ++i) {
            const unsigned index = options.littleEndian ? options.lengthBytes - 1 - i : i;
            length = (length << 8) | bytes[offset + index];
        }
        if (options.lengthIncludesHeader) {
            if (length < header) { result.error = "LTV length is smaller than its header at byte offset " + std::to_string(start) + "."; return result; }
            length -= header;
        }
        offset += options.lengthBytes;
        Record record;
        record.offset = start;
        record.tag.assign(bytes.begin() + offset, bytes.begin() + offset + options.tagBytes);
        offset += options.tagBytes;
        if (length > bytes.size() - offset) { result.error = "Truncated LTV value at byte offset " + std::to_string(offset) + ": declared " + std::to_string(length) + " bytes, remaining " + std::to_string(bytes.size() - offset) + "."; return result; }
        record.value.assign(bytes.begin() + offset, bytes.begin() + offset + static_cast<std::size_t>(length));
        offset += static_cast<std::size_t>(length);
        result.records.push_back(std::move(record));
    }
    result.ok = true;
    return result;
}
BuildResult build(const std::vector<uint8_t>& tag, const std::vector<uint8_t>& value, const Options& options) {
    BuildResult result;
    if (!valid(options)) { result.error = "Length and tag widths must be between 1 and 4 bytes."; return result; }
    if (tag.size() != options.tagBytes) { result.error = "Tag does not match the configured tag width."; return result; }
    const uint64_t length = static_cast<uint64_t>(value.size()) + (options.lengthIncludesHeader ? options.lengthBytes + options.tagBytes : 0);
    const uint64_t maximum = (uint64_t{1} << (options.lengthBytes * 8)) - 1;
    if (length > maximum) { result.error = "Value does not fit the configured length width."; return result; }
    result.bytes.resize(options.lengthBytes);
    for (unsigned i = 0; i < options.lengthBytes; ++i) {
        const unsigned index = options.littleEndian ? i : options.lengthBytes - 1 - i;
        result.bytes[index] = static_cast<uint8_t>((length >> (i * 8)) & 0xff);
    }
    result.bytes.insert(result.bytes.end(), tag.begin(), tag.end());
    result.bytes.insert(result.bytes.end(), value.begin(), value.end());
    result.ok = true;
    return result;
}
}
