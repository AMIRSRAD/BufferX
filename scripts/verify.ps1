# Full verification: C++ core, C ABI, and frontend.
#
#   pwsh scripts/verify.ps1
#
# Exits non-zero if anything fails, so it can gate a commit or run in CI.

$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $PSScriptRoot
$failures = @()

function Step($name, [scriptblock]$body) {
    Write-Host ""
    Write-Host "==> $name" -ForegroundColor Cyan
    & $body
    if ($LASTEXITCODE -ne 0) {
        $script:failures += $name
        Write-Host "    FAILED ($name)" -ForegroundColor Red
    }
}

# MSVC environment is needed for the C++ build on Windows.
$vcvars = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if (-not (Test-Path $vcvars)) {
    $vcvars = "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
}

$vcpkg = if ($env:VCPKG_ROOT) { $env:VCPKG_ROOT } else { 'C:/vcpkg' }
$toolchain = "$vcpkg/scripts/buildsystems/vcpkg.cmake"

Step 'Configure C++' {
    cmd /c "`"$vcvars`" >nul 2>&1 && cd /d $root && cmake -S . -B build/cmake -G Ninja -DCMAKE_TOOLCHAIN_FILE=$toolchain -DVCPKG_TARGET_TRIPLET=x64-windows -DBUFFERX_BUILD_TESTS=ON 2>&1"
}

Step 'Build C++' {
    cmd /c "`"$vcvars`" >nul 2>&1 && cd /d $root && cmake --build build/cmake 2>&1"
}

Step 'C++ tests' {
    cmd /c "cd /d $root\build\cmake && ctest --output-on-failure 2>&1"
}

Step 'Frontend typecheck' {
    cmd /c "cd /d $root\app && pnpm typecheck 2>&1"
}

Step 'Frontend tests' {
    cmd /c "cd /d $root\app && pnpm test 2>&1"
}

Step 'Frontend build' {
    cmd /c "cd /d $root\app && pnpm build 2>&1"
}

Write-Host ""
if ($failures.Count -eq 0) {
    Write-Host "=== ALL CHECKS PASSED ===" -ForegroundColor Green
    exit 0
}

Write-Host "=== FAILED: $($failures -join ', ') ===" -ForegroundColor Red
exit 1
