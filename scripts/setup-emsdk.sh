#!/usr/bin/env bash
# Installs the Emscripten SDK into third_party/emsdk.
#
# This is what unlocks the browser build: the same C++ core the desktop app
# links natively gets compiled to WebAssembly, so the web build runs identical
# banking logic rather than a reimplementation of it.
#
# Downloads roughly 1.5 GB. Run once.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK="${ROOT}/third_party/emsdk"
VERSION="${EMSDK_VERSION:-4.0.12}"

command -v git >/dev/null 2>&1 || { echo "error: git is required" >&2; exit 1; }

if [[ ! -d "${EMSDK}" ]]; then
    echo "==> Cloning emsdk"
    mkdir -p "${ROOT}/third_party"
    git clone --depth 1 https://github.com/emscripten-core/emsdk.git "${EMSDK}"
fi

cd "${EMSDK}"
echo "==> Installing Emscripten ${VERSION} (this downloads ~1.5 GB)"
./emsdk install "${VERSION}"
./emsdk activate "${VERSION}"

cat <<EOF

Done. Activate it in each new shell with:
    source ${EMSDK}/emsdk_env.sh

Then build the WebAssembly engine:
    bash scripts/build-openssl-wasm.sh   # once
    bash scripts/build-wasm.sh
EOF
