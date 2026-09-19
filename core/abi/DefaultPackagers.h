#pragma once

// The packager definitions compiled into the engine from data/packagers.xml.
//
// The Qt application shipped these as a Qt resource, so a freshly launched app
// could decode a buffer immediately. When Qt was removed the replacement booted
// with an empty registry, which left the app unable to decode anything until
// the operator located the file themselves. This restores that behaviour.
//
// data/packagers.xml remains the single source of truth: edit it, rebuild, and
// the built-in set follows. `packager.loadXml` still replaces the registry at
// runtime for operators working against a host with its own definitions.
//
// The definition lives in a generated .cpp (see DefaultPackagers.cpp.in) rather
// than in this header, for two reasons: MSVC caps a single string literal at
// 65,535 bytes and this document is larger, so it is emitted as a byte array;
// and keeping it out of the header means it is compiled once per target instead
// of once per translation unit that includes this.

namespace bufferx {

/** NUL-terminated UTF-8 XML. Never null. */
extern const char* const kDefaultPackagersXml;

/** Byte length excluding the terminator. */
extern const unsigned long kDefaultPackagersXmlSize;

} // namespace bufferx
