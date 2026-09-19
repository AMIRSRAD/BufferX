# Installs the Emscripten SDK into third_party/emsdk.
#
# This is what unlocks the browser build: the same C++ core that the desktop app
# links natively gets compiled to WebAssembly so the web build runs identical
# banking logic rather than a reimplementation.
#
# Downloads roughly 1.5 GB. Run once.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$emsdk = Join-Path $root 'third_party\emsdk'
$version = if ($env:EMSDK_VERSION) { $env:EMSDK_VERSION } else { '4.0.12' }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'git is required to install the Emscripten SDK.'
}

if (-not (Test-Path $emsdk)) {
    Write-Host '==> Cloning emsdk'
    New-Item -ItemType Directory -Force (Split-Path $emsdk) | Out-Null
    git clone --depth 1 https://github.com/emscripten-core/emsdk.git $emsdk
}

Push-Location $emsdk
try {
    Write-Host "==> Installing Emscripten $version (this downloads ~1.5 GB)"
    & .\emsdk.bat install $version
    & .\emsdk.bat activate $version
}
finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Done. Activate it in each new shell with:'
Write-Host "    $emsdk\emsdk_env.ps1"
Write-Host ''
Write-Host 'Then build the WebAssembly engine:'
Write-Host '    bash scripts/build-openssl-wasm.sh   # once'
Write-Host '    bash scripts/build-wasm.sh'
