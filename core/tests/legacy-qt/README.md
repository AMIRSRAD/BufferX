# Legacy test suite (pending port)

`BufferXTests.cpp` is the Qt-era regression suite. It is **not built** — it links the deleted
`Backend` adapter and uses `QString`, `QByteArray`, and `QJsonObject`.

It is kept in the tree rather than deleted because it holds the accumulated regression vectors for
the banking logic: ISO decode/encode across packagers and layouts, MAC, ISO-0/1/3/4 PIN blocks, Visa
PVV, IBM 3624, PIN translation, the eight symmetric algorithms, RSA, TLV, banking utilities, and
IranSystem. Those vectors are the reason the 2.0 refactor could be verified at all, and they should
not be lost to a `git rm`.

## Where its coverage lives now

| Area | Ported to |
|---|---|
| IranSystem ATM-engine vectors | `core/tests/IranSystemPortTest.cpp` |
| Windows-1256 and EBCDIC codecs | `core/tests/Cp1256DifferentialTest.cpp` (differential vs Win32) |
| Packager XML loading | `core/tests/PackagerLoaderTest.cpp` |
| Engine operations end to end | `core/abi/tests/AbiTest.cpp` |

## What still needs porting

Everything else: the ISO codec matrix, MAC, the full PIN block and PIN verification set, the crypto
algorithm matrix, RSA, and TLV. Port them against `BufferXCore` directly (std types, no Qt), routing
any assertion that went through `Backend` through the C ABI instead.

Delete this file and `BufferXTests.cpp` once that is done.
