#!/usr/bin/env bash
# Builds OpenSSL's libcrypto for wasm32-emscripten into third_party/openssl-wasm.
#
# Run once. Takes several minutes.
#
# Requires: emscripten on PATH, plus perl and make (OpenSSL's build system needs
# both). On Windows, Git for Windows supplies perl; `make` must be installed
# separately (for example via MSYS2, or `winget install GnuWin32.Make`).
#
# Only libcrypto is built. BufferX never opens a TLS connection -- the ISO host
# tester speaks raw TCP from the Rust side -- so libssl is dead weight.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${OPENSSL_VERSION:-3.5.4}"
WORK="${ROOT}/third_party/openssl-src"
PREFIX="${ROOT}/third_party/openssl-wasm"

if [[ -f "${PREFIX}/lib/libcrypto.a" ]]; then
    echo "==> Reusing existing WebAssembly libcrypto: ${PREFIX}/lib/libcrypto.a"
    exit 0
fi

for tool in emcc em++ emar emranlib perl make; do
    command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool not found on PATH" >&2; exit 1; }
done

mkdir -p "${ROOT}/third_party"

if [[ ! -d "${WORK}" ]]; then
    echo "==> Fetching OpenSSL ${VERSION}"
    curl -fsSL "https://github.com/openssl/openssl/releases/download/openssl-${VERSION}/openssl-${VERSION}.tar.gz" \
        -o "${ROOT}/third_party/openssl.tar.gz"
    mkdir -p "${WORK}"
    tar -xzf "${ROOT}/third_party/openssl.tar.gz" -C "${WORK}" --strip-components=1
    rm "${ROOT}/third_party/openssl.tar.gz"
fi

cd "${WORK}"

echo "==> Configuring for wasm32-emscripten"
# no-asm            : no wasm assembly backend exists
# no-threads        : the module runs single-threaded in the browser
# no-engine/no-dso  : no dynamic loading in wasm
# no-afalgeng       : Linux kernel crypto, meaningless here
# no-ssl/no-tls     : libcrypto only
# no-sock           : no BSD sockets in the sandbox
make clean >/dev/null 2>&1 || true
CC=emcc CXX=em++ AR=emar RANLIB=emranlib CROSS_COMPILE= \
./Configure linux-generic32 \
    no-asm no-threads no-engine no-dso no-afalgeng no-shared \
    no-ssl no-tls no-dtls no-sock no-ui-console no-stdio \
    --prefix="${PREFIX}"

echo "==> Building libcrypto (this takes a while)"
emmake make -j"$(nproc 2>/dev/null || echo 4)" build_generated libcrypto.a

echo "==> Installing headers and libcrypto.a"
mkdir -p "${PREFIX}/lib" "${PREFIX}/include"
cp libcrypto.a "${PREFIX}/lib/"
cp -r include/openssl "${PREFIX}/include/"

echo "==> Done: ${PREFIX}"
ls -la "${PREFIX}/lib"
