#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace ltvtool {
struct Options { unsigned lengthBytes = 2; unsigned tagBytes = 1; bool littleEndian = false; bool lengthIncludesHeader = false; };
struct Record { std::size_t offset = 0; std::vector<uint8_t> tag; std::vector<uint8_t> value; };
struct ParseResult { bool ok = false; std::string error; std::vector<Record> records; };
struct BuildResult { bool ok = false; std::string error; std::vector<uint8_t> bytes; };
ParseResult parse(const std::vector<uint8_t>& bytes, const Options& options);
BuildResult build(const std::vector<uint8_t>& tag, const std::vector<uint8_t>& value, const Options& options);
}
