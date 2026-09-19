#!/usr/bin/env bash
# Builds BufferXCore + the C ABI to WebAssembly, producing the module the
# frontend loads when it is not running inside Tauri.
#
# Output: app/public/wasm/bufferx_core.js and bufferx_core.wasm
#
# Prerequisites:
#   1. Emscripten SDK on PATH (emcc, emcmake).  scripts/setup-emsdk.sh installs it.
#   2. OpenSSL built for wasm32-emscripten.     See OPENSSL_WASM_ROOT below.
#
# Why OpenSSL has to be built separately: emscripten ships no OpenSSL port, and
# BufferXCore needs the low-level DES primitives that ISO PIN translation and
# legacy ATM MACs are specified in terms of.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ROOT}/build-wasm"
OUT_DIR="${ROOT}/app/public/wasm"

if ! command -v emcmake >/dev/null 2>&1; then
    cat >&2 <<'EOF'
error: emcmake not found on PATH.

Install the Emscripten SDK first:
    scripts/setup-emsdk.sh          (or setup-emsdk.ps1 on Windows)
then activate it:
    source <emsdk>/emsdk_env.sh
EOF
    exit 1
fi

OPENSSL_WASM_ROOT="${OPENSSL_WASM_ROOT:-${ROOT}/third_party/openssl-wasm}"
if [[ ! -f "${OPENSSL_WASM_ROOT}/lib/libcrypto.a" ]]; then
    cat >&2 <<EOF
error: no WebAssembly build of OpenSSL at
    ${OPENSSL_WASM_ROOT}

Build it once with:
    scripts/build-openssl-wasm.sh

or point OPENSSL_WASM_ROOT at an existing build. It must contain
lib/libcrypto.a and include/openssl/.
EOF
    exit 1
fi

echo "==> Configuring (emscripten)"
emcmake cmake -S "${ROOT}" -B "${BUILD_DIR}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUFFERX_BUILD_TESTS=OFF \
    -DBUFFERX_WASM=ON \
    -DOPENSSL_ROOT_DIR="${OPENSSL_WASM_ROOT}" \
    -DOPENSSL_INCLUDE_DIR="${OPENSSL_WASM_ROOT}/include" \
    -DOPENSSL_CRYPTO_LIBRARY="${OPENSSL_WASM_ROOT}/lib/libcrypto.a"

echo "==> Building"
cmake --build "${BUILD_DIR}" --target bufferx_wasm

mkdir -p "${OUT_DIR}"
cp "${BUILD_DIR}/core/abi/bufferx_core.js"   "${OUT_DIR}/"
cp "${BUILD_DIR}/core/abi/bufferx_core.wasm" "${OUT_DIR}/"

echo "==> Done"
ls -la "${OUT_DIR}"
echo
echo "The web build now has an engine. Run:  pnpm --dir app dev"
