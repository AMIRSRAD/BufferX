$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskManifest = Join-Path $taskRoot 'src-tauri/policy-check/Cargo.toml'
$taskOutput = Join-Path $taskRoot 'build/policy-tests'
cargo build --locked --manifest-path $taskManifest --example policy-fixture --features test-fixtures --target-dir $taskOutput
if ($LASTEXITCODE -ne 0) { throw 'Fixture build failed' }
$taskExtension = if ($IsWindows -or $env:OS -eq 'Windows_NT') { '.exe' } else { '' }
$taskGuardLog = Join-Path $taskRoot 'build/policy-production-guard.log'
cargo check --locked --manifest-path $taskManifest --bin bufferx-policy-check --features test-fixtures --target-dir $taskOutput *> $taskGuardLog
if ($LASTEXITCODE -eq 0 -or -not (Select-String -LiteralPath $taskGuardLog -SimpleMatch 'A production checker must never be built with test-fixtures enabled.')) {
    throw 'Production checker fixture guard failed'
}
$taskPreviousHelper = $env:BUFFERX_TEST_HELPER
$env:BUFFERX_TEST_HELPER = Join-Path $taskOutput "debug/examples/policy-fixture$taskExtension"
try {
    cargo test --locked --manifest-path $taskManifest --lib --features test-fixtures --target-dir $taskOutput -- --test-threads=1
    if ($LASTEXITCODE -ne 0) { throw 'Startup policy tests failed' }
} finally {
    $env:BUFFERX_TEST_HELPER = $taskPreviousHelper
}
