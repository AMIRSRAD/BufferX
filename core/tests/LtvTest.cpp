#include "bufferx/Ltv.h"
#include <cstdio>
int main() {
    int failures = 0;
    auto check = [&](bool ok, const char* label) { if (!ok) { std::fprintf(stderr, "FAIL: %s\n", label); ++failures; } };
    const std::vector<uint8_t> value{0x41, 0x42, 0x43};
    for (unsigned lengthBytes = 1; lengthBytes <= 4; ++lengthBytes) {
        for (unsigned tagBytes = 1; tagBytes <= 4; ++tagBytes) {
            for (bool little : {false, true}) for (bool includes : {false, true}) {
                ltvtool::Options options{lengthBytes, tagBytes, little, includes};
                std::vector<uint8_t> tag(tagBytes, 0x9f);
                auto encoded = ltvtool::build(tag, value, options);
                check(encoded.ok, "build for every supported dialect");
                auto wire = encoded.bytes;
                wire.insert(wire.end(), encoded.bytes.begin(), encoded.bytes.end());
                auto parsed = ltvtool::parse(wire, options);
                check(parsed.ok && parsed.records.size() == 2 && parsed.records[0].value == value && parsed.records[1].offset == encoded.bytes.size(), "multiple-record round trip");
            }
        }
    }
    check(ltvtool::build({0x01}, value, {}).bytes == std::vector<uint8_t>({0, 3, 1, 0x41, 0x42, 0x43}), "big endian golden bytes");
    check(ltvtool::build({0x01}, value, {2, 1, true, true}).bytes == std::vector<uint8_t>({6, 0, 1, 0x41, 0x42, 0x43}), "little endian inclusive golden bytes");
    check(!ltvtool::parse({0, 8, 1, 0x41}, {}).ok, "truncated value rejected");
    check(!ltvtool::parse({0}, {}).ok, "truncated header rejected");
    check(!ltvtool::parse({1, 1}, {1, 1, false, true}).ok, "undersized inclusive length rejected");
    check(!ltvtool::build({1}, std::vector<uint8_t>(256), {1, 1, false, false}).ok, "length overflow rejected");
    check(!ltvtool::build({1, 2}, value, {}).ok, "tag width mismatch rejected");
    check(!ltvtool::parse({}, {0, 1, false, false}).ok, "invalid options rejected");
    check(ltvtool::parse({0, 0, 1}, {}).ok, "empty value supported");
    return failures ? 1 : 0;
}
