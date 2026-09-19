#pragma once

// Portable text conversion for the BufferX core.
//
// The IranSystem converter previously called the Win32 APIs MultiByteToWideChar
// and WideCharToMultiByte, which made it Windows-only -- every other platform
// returned "IranSystem conversion is only available on Windows builds." That is
// fatal for a WebAssembly build, so the Windows-1256 codec is implemented here
// as a table instead. The table is verified byte-for-byte against the Win32
// implementation by a differential test (see tests/TextCodecTests.cpp).

#include <cstdint>
#include <string>
#include <vector>

namespace textcodec {

// U+FFFD, substituted for malformed UTF-8 input.
inline constexpr char32_t kReplacementCharacter = 0xFFFD;

// Windows substitutes '?' for codepoints it cannot represent in a code page.
inline constexpr unsigned char kUnmappableByte = '?';

// --- UTF-8 <-> UTF-32 -------------------------------------------------------
//
// The shaping algorithms index text one character at a time, so they operate on
// UTF-32. Persian and Arabic live entirely in the BMP, which is why the original
// UTF-16 (QString) indexing was correct; UTF-32 preserves that behaviour while
// also being correct for supplementary-plane input.

std::u32string utf8ToUtf32(const std::string& utf8);
std::string utf32ToUtf8(const std::u32string& utf32);

// --- Windows-1256 (Arabic) --------------------------------------------------

// Decodes CP1256 bytes to text. Every byte 0x00-0xFF has a defined mapping, so
// decoding cannot fail.
std::u32string cp1256ToUtf32(const std::vector<unsigned char>& bytes);
std::string cp1256ToUtf8(const std::vector<unsigned char>& bytes);

// Encodes text to CP1256. Codepoints with no direct representation fall back to
// the same best-fit substitutions Windows applies (for example Farsi Yeh
// U+06CC -> 0xED and Persian digits U+06F0..U+06F9 -> '0'..'9'); anything still
// unmapped becomes '?', matching the Win32 default character.
std::vector<unsigned char> utf32ToCp1256(const std::u32string& text);
std::vector<unsigned char> utf8ToCp1256(const std::string& text);

// Reports whether a codepoint has a direct (non best-fit, non '?') CP1256
// encoding. Used by tests to separate exact mappings from substitutions.
bool hasDirectCp1256Encoding(char32_t codepoint);

// --- EBCDIC (code page 037) -------------------------------------------------
//
// Mainframe hosts still speak EBCDIC, so operators need to convert both ways.
// This was also Windows-only before; the tables are generated from Win32 and
// behave identically, including refusing best-fit substitution.

// Converts ASCII text to EBCDIC. Returns false when the input contains a byte
// outside ASCII, matching the original's MB_ERR_INVALID_CHARS behaviour.
bool asciiToEbcdic037(const std::string& ascii, std::vector<unsigned char>& out);

// Converts EBCDIC bytes to UTF-8. Every byte has a mapping, so this cannot fail.
std::string ebcdic037ToUtf8(const std::vector<unsigned char>& bytes);

// --- Small string helpers ---------------------------------------------------
//
// Replacements for the QString conveniences the converter relied on.

std::u32string trimWhitespace(const std::u32string& text);
std::string trimWhitespaceUtf8(const std::string& text);
bool isWhitespace(char32_t codepoint);

} // namespace textcodec
