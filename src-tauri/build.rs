//! Build script for the BufferX desktop shell.
//!
//! Three jobs, in this order:
//!
//! 1. Build the C++ side with CMake — `BufferXCore` (the banking domain
//!    library) and `BufferXAbi` (the C shim the Rust side calls). The root
//!    `CMakeLists.txt` is configured with `BUFFERX_BUILD_TESTS=OFF`, because the
//!    verification executables are run by CTest, not by the app build.
//! 2. Tell cargo how to link the result, including OpenSSL's libcrypto.
//! 3. Run `tauri_build::build()`, which generates the app context, the
//!    capability schemas under `gen/`, and the Windows resource block.
//!
//! Locating OpenSSL is the part that goes wrong first for a new contributor and
//! the part CMake reports worst, so every step of it is overridable and a
//! failure is explained in full rather than left to the linker:
//!
//! | Variable                   | Effect |
//! |----------------------------|--------|
//! | `BUFFERX_OPENSSL_LIB_DIR`  | Directory holding the crypto library. Wins over everything else. |
//! | `BUFFERX_OPENSSL_LIB_NAME` | Link name for libcrypto. Default `libcrypto` on Windows, `crypto` elsewhere. |
//! | `OPENSSL_ROOT_DIR`         | Handed to CMake and used to derive the library directory. |
//! | `VCPKG_ROOT`               | vcpkg checkout supplying the CMake toolchain file on Windows. Default `C:/vcpkg`. |
//! | `VCPKG_TARGET_TRIPLET`     | vcpkg triplet. Default derived from the Rust target architecture. |
//! | `BUFFERX_CORE_PROFILE`     | CMake build type for the C++ core. Default `Release`. |

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

/// Static libraries produced by the CMake build, in link order: the ABI shim
/// depends on the core, and the core depends on libcrypto.
const CORE_LIBRARIES: [&str; 2] = ["BufferXAbi", "BufferXCore"];

fn main() {
    let manifest_dir = PathBuf::from(required_env("CARGO_MANIFEST_DIR"));
    let repo_root = match manifest_dir.parent() {
        Some(parent) => parent.to_path_buf(),
        None => fail("src-tauri has no parent directory, so the repository root cannot be found."),
    };

    emit_rerun_triggers(&repo_root);

    let target = TargetInfo::from_env();
    let openssl = locate_openssl(&target);

    let library_dir = build_core(&repo_root, &target, &openssl);
    emit_link_directives(&library_dir, &target, &openssl);

    // Best effort, Windows only: put the OpenSSL DLL next to the executable so
    // `cargo tauri dev` starts without the developer having to fix PATH first.
    stage_runtime_dependencies(&target, &openssl);

    build_policy_checker(&manifest_dir, &repo_root, &target);

    // Last, because it consumes tauri.conf.json and the capability files and
    // should be the thing that fails if those are malformed.
    tauri_build::build();
}

/// Build a standalone production helper in a separate Cargo output directory.
/// Tauri stages the target-suffixed sidecar beside the app and bundles it in installers.
fn build_policy_checker(manifest_dir: &Path, repo_root: &Path, target: &TargetInfo) {
    let source = manifest_dir.join("policy-check");
    println!("cargo:rerun-if-changed={}", source.display());
    let triple = required_env("TARGET");
    let output = repo_root.join("build/policy-check");
    let status = std::process::Command::new(required_env("CARGO"))
        .args([
            "build",
            "--locked",
            "--release",
            "--no-default-features",
            "--bin",
            "bufferx-policy-check",
            "--target",
            &triple,
        ])
        .arg("--manifest-path")
        .arg(source.join("Cargo.toml"))
        .arg("--target-dir")
        .arg(&output)
        .status()
        .expect("Cannot start the policy checker build");
    assert!(status.success(), "Production policy checker build failed");
    let extension = if target.is_windows() { ".exe" } else { "" };
    let binary = output
        .join(&triple)
        .join("release")
        .join(format!("bufferx-policy-check{extension}"));
    let sidecars = manifest_dir.join("binaries");
    fs::create_dir_all(&sidecars).expect("Cannot create sidecar staging directory");
    fs::copy(
        binary,
        sidecars.join(format!("BufferX.PolicyCheck-{triple}{extension}")),
    )
    .expect("Cannot stage the policy checker");
}

// ---------------------------------------------------------------------------
// Target description
// ---------------------------------------------------------------------------

struct TargetInfo {
    os: String,
    env: String,
    arch: String,
    /// Whether the Rust target links the CRT statically. The C++ core must
    /// match, or MSVC rejects the mixed runtime at link time.
    crt_static: bool,
}

impl TargetInfo {
    fn from_env() -> Self {
        Self {
            os: required_env("CARGO_CFG_TARGET_OS"),
            env: env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default(),
            arch: required_env("CARGO_CFG_TARGET_ARCH"),
            crt_static: env::var("CARGO_CFG_TARGET_FEATURE")
                .unwrap_or_default()
                .split(',')
                .any(|feature| feature == "crt-static"),
        }
    }

    fn is_windows(&self) -> bool {
        self.os == "windows"
    }

    fn is_msvc(&self) -> bool {
        self.env == "msvc"
    }
}

// ---------------------------------------------------------------------------
// OpenSSL discovery
// ---------------------------------------------------------------------------

struct Vcpkg {
    root: PathBuf,
    toolchain: PathBuf,
    triplet: String,
}

struct OpenSsl {
    /// Added to the linker search path when we could work one out. `None` means
    /// "let the platform linker find it", which is normal on Linux and macOS.
    lib_dir: Option<PathBuf>,
    /// The `-l` name for libcrypto.
    link_name: String,
    /// Passed to CMake as `OPENSSL_ROOT_DIR` when known.
    root: Option<PathBuf>,
    /// vcpkg integration, Windows only.
    vcpkg: Option<Vcpkg>,
}

fn locate_openssl(target: &TargetInfo) -> OpenSsl {
    let link_name = non_empty_env("BUFFERX_OPENSSL_LIB_NAME").unwrap_or_else(|| {
        if target.is_windows() {
            "libcrypto".to_string()
        } else {
            "crypto".to_string()
        }
    });

    let vcpkg = if target.is_windows() {
        locate_vcpkg(&target.arch)
    } else {
        None
    };

    let root = env_dir("OPENSSL_ROOT_DIR").or_else(|| {
        if target.os == "macos" {
            // Homebrew keeps OpenSSL out of the default search path, so the
            // usual prefixes are worth a look before giving up.
            first_existing_dir(&[
                PathBuf::from("/opt/homebrew/opt/openssl@3"),
                PathBuf::from("/usr/local/opt/openssl@3"),
            ])
        } else {
            None
        }
    });

    let lib_dir = env_dir("BUFFERX_OPENSSL_LIB_DIR")
        .or_else(|| {
            root.as_ref()
                .and_then(|root| first_existing_dir(&[root.join("lib"), root.join("lib64")]))
        })
        .or_else(|| {
            vcpkg
                .as_ref()
                .map(|vcpkg| vcpkg.root.join("installed").join(&vcpkg.triplet).join("lib"))
                .filter(|dir| dir.is_dir())
        });

    let openssl = OpenSsl {
        lib_dir,
        link_name,
        root,
        vcpkg,
    };

    verify_openssl(target, &openssl);
    openssl
}

fn locate_vcpkg(arch: &str) -> Option<Vcpkg> {
    let root = env_dir("VCPKG_ROOT").unwrap_or_else(|| PathBuf::from("C:/vcpkg"));
    let toolchain = root.join("scripts/buildsystems/vcpkg.cmake");
    if !toolchain.is_file() {
        return None;
    }

    let triplet = non_empty_env("VCPKG_TARGET_TRIPLET").unwrap_or_else(|| {
        match arch {
            "x86_64" => "x64-windows",
            "aarch64" => "arm64-windows",
            "x86" => "x86-windows",
            _ => "x64-windows",
        }
        .to_string()
    });

    Some(Vcpkg {
        root,
        toolchain,
        triplet,
    })
}

/// Checks that a crypto library is actually where we think it is, and explains
/// the situation in full if it is not. On Windows this is fatal: there is no
/// system OpenSSL to fall back on, and letting CMake or the linker fail instead
/// produces a much worse error. Elsewhere it is a warning, because the platform
/// linker regularly finds libcrypto without any help from us.
fn verify_openssl(target: &TargetInfo, openssl: &OpenSsl) {
    if let Some(dir) = &openssl.lib_dir {
        if crypto_library_exists(dir, &openssl.link_name) {
            return;
        }
        warn(&format!(
            "No `{}` library found in {} -- set BUFFERX_OPENSSL_LIB_NAME if it is named differently.",
            openssl.link_name,
            dir.display()
        ));
        if !target.is_windows() {
            return;
        }
    }

    if !target.is_windows() {
        return;
    }

    warn("BufferX could not locate OpenSSL (libcrypto) for this target.");
    warn("Looked in, in order:");
    warn(&format!(
        "  1. $BUFFERX_OPENSSL_LIB_DIR       {}",
        describe_env("BUFFERX_OPENSSL_LIB_DIR")
    ));
    warn(&format!(
        "  2. $OPENSSL_ROOT_DIR/lib          {}",
        describe_env("OPENSSL_ROOT_DIR")
    ));
    match &openssl.vcpkg {
        Some(vcpkg) => warn(&format!(
            "  3. {}",
            vcpkg
                .root
                .join("installed")
                .join(&vcpkg.triplet)
                .join("lib")
                .display()
        )),
        None => warn("  3. <vcpkg>/installed/<triplet>/lib (no vcpkg toolchain file found)"),
    }
    warn("Fix by doing any one of these:");
    warn("  - vcpkg install openssl:x64-windows   (then leave VCPKG_ROOT at C:/vcpkg or set it)");
    warn("  - set OPENSSL_ROOT_DIR to an OpenSSL 3 installation");
    warn("  - set BUFFERX_OPENSSL_LIB_DIR, plus BUFFERX_OPENSSL_LIB_NAME if the file is not libcrypto.lib");
    fail("OpenSSL was not found. The build warnings above list every path tried and how to fix it.");
}

fn crypto_library_exists(dir: &Path, link_name: &str) -> bool {
    [
        format!("{link_name}.lib"),
        format!("lib{link_name}.a"),
        format!("lib{link_name}.so"),
        format!("lib{link_name}.dylib"),
        format!("{link_name}.a"),
    ]
    .iter()
    .any(|candidate| dir.join(candidate).exists())
}

// ---------------------------------------------------------------------------
// CMake build
// ---------------------------------------------------------------------------

/// Configures and builds the repository root `CMakeLists.txt`, returning the
/// directory every static library was written to.
///
/// Named targets are built rather than the default one. The root project
/// installs nothing, so `--target install` — what the `cmake` crate does by
/// default — has no project file to run under a Visual Studio generator, and
/// `all` is spelled `ALL_BUILD` there. Naming the libraries avoids both
/// generator quirks and has the side benefit of never building anything the
/// desktop app does not link.
fn build_core(repo_root: &Path, target: &TargetInfo, openssl: &OpenSsl) -> PathBuf {
    let out_dir = PathBuf::from(required_env("OUT_DIR"));
    let library_dir = out_dir.join("lib");

    // The root CMakeLists.txt only adds core/abi when it has a CMakeLists of
    // its own. Asking for a target that does not exist is a hard CMake error,
    // so the ABI shim is requested only once it is there. The link step below
    // is what reports its absence, and it says exactly what is missing.
    let mut targets: Vec<&str> = vec!["BufferXCore"];
    if repo_root.join("core/abi/CMakeLists.txt").is_file() {
        targets.push("BufferXAbi");
    }

    let mut install_dir = out_dir.clone();
    for build_target in targets {
        install_dir = configure(repo_root, target, openssl, &library_dir)
            .build_target(build_target)
            .build();
    }

    for library in CORE_LIBRARIES {
        if !static_library_exists(&library_dir, library) {
            warn(&format!(
                "CMake produced no `{library}` archive in {}.",
                library_dir.display()
            ));
            if library == "BufferXAbi" {
                warn("core/abi/CMakeLists.txt must define a static library target named BufferXAbi.");
                warn("The root CMakeLists.txt only adds core/abi when that file exists.");
            }
        }
    }

    // The pinned archive directory is authoritative; the other two cover a
    // CMakeLists that installs its libraries or overrides the output path.
    println!("cargo:rustc-link-search=native={}", library_dir.display());
    println!(
        "cargo:rustc-link-search=native={}",
        install_dir.join("lib").display()
    );
    println!(
        "cargo:rustc-link-search=native={}",
        install_dir.join("build").display()
    );

    library_dir
}

/// One fully configured CMake invocation. Called once per target; the build
/// directory is shared and cached, so only the first configure costs anything.
fn configure(
    repo_root: &Path,
    target: &TargetInfo,
    openssl: &OpenSsl,
    library_dir: &Path,
) -> cmake::Config {
    let mut config = cmake::Config::new(repo_root);
    config.define("BUFFERX_BUILD_TESTS", "OFF");

    // Pin every archive to one directory. Without this, single-config
    // generators drop libraries beside their target directory and multi-config
    // generators add a per-config subdirectory, and the link search path would
    // have to guess at both.
    config.define("CMAKE_ARCHIVE_OUTPUT_DIRECTORY", cmake_path(library_dir));
    for config_name in ["DEBUG", "RELEASE", "RELWITHDEBINFO", "MINSIZEREL"] {
        config.define(
            format!("CMAKE_ARCHIVE_OUTPUT_DIRECTORY_{config_name}"),
            cmake_path(library_dir),
        );
    }

    // The core is built Release regardless of the Rust profile. It is a
    // dependency rather than the thing under debug, and on MSVC a Debug build
    // would select the debug CRT while rustc always links the release one.
    config.profile(&non_empty_env("BUFFERX_CORE_PROFILE").unwrap_or_else(|| "Release".to_string()));

    if target.is_msvc() {
        // The `cmake` crate replaces CMAKE_CXX_FLAGS wholesale, which drops the
        // /EHsc that MSVC would otherwise supply by default. Without it, the
        // try/catch in the ABI shim compiles with no unwind semantics and a
        // thrown exception terminates the process instead of becoming an
        // INTERNAL envelope — the one guarantee the C ABI makes to this crate.
        config.cxxflag("/EHsc");

        // Never the /MDd or /MTd variants: rustc links msvcrt, not msvcrtd.
        config.define(
            "CMAKE_MSVC_RUNTIME_LIBRARY",
            if target.crt_static {
                "MultiThreaded"
            } else {
                "MultiThreadedDLL"
            },
        );
    }

    if let Some(vcpkg) = &openssl.vcpkg {
        config.define("CMAKE_TOOLCHAIN_FILE", cmake_path(&vcpkg.toolchain));
        config.define("VCPKG_TARGET_TRIPLET", &vcpkg.triplet);
    }
    if let Some(root) = &openssl.root {
        config.define("OPENSSL_ROOT_DIR", cmake_path(root));
    }

    config
}

fn static_library_exists(dir: &Path, name: &str) -> bool {
    [format!("{name}.lib"), format!("lib{name}.a"), format!("{name}.a")]
        .iter()
        .any(|candidate| dir.join(candidate).exists())
}

// ---------------------------------------------------------------------------
// Link directives
// ---------------------------------------------------------------------------

fn emit_link_directives(_library_dir: &Path, target: &TargetInfo, openssl: &OpenSsl) {
    for library in CORE_LIBRARIES {
        println!("cargo:rustc-link-lib=static={library}");
    }

    if let Some(dir) = &openssl.lib_dir {
        println!("cargo:rustc-link-search=native={}", dir.display());
    }
    // Deliberately not `static=`: a vcpkg or system OpenSSL is normally a
    // shared library reached through an import library, and MSVC treats both
    // the same way on the command line.
    println!("cargo:rustc-link-lib={}", openssl.link_name);

    // BufferXCore is C++, so the standard library it was compiled against has
    // to be on the link line. MSVC embeds that reference in the object files
    // and needs nothing here.
    match (target.os.as_str(), target.env.as_str()) {
        ("macos", _) | ("ios", _) => println!("cargo:rustc-link-lib=dylib=c++"),
        ("windows", "msvc") => {}
        _ => println!("cargo:rustc-link-lib=dylib=stdc++"),
    }

    if target.is_windows() {
        // Pulled in by libcrypto: sockets, certificate store, and the entropy
        // and registry calls its Windows provider makes.
        for system_library in ["ws2_32", "crypt32", "advapi32", "user32", "gdi32"] {
            println!("cargo:rustc-link-lib=dylib={system_library}");
        }
    }
}

/// Copies the OpenSSL DLL beside the built executable on Windows.
///
/// A vcpkg OpenSSL is a shared library whose DLL lives in the vcpkg tree rather
/// than anywhere the loader looks, so without this the app builds cleanly and
/// then fails to start. Entirely best effort — a failure here is never fatal.
fn stage_runtime_dependencies(target: &TargetInfo, openssl: &OpenSsl) {
    if !target.is_windows() {
        return;
    }
    let Some(vcpkg) = &openssl.vcpkg else {
        return;
    };

    let bin_dir = vcpkg.root.join("installed").join(&vcpkg.triplet).join("bin");
    let Ok(entries) = fs::read_dir(&bin_dir) else {
        return;
    };
    // OUT_DIR is <target>/<profile>/build/<crate>-<hash>/out, so the directory
    // cargo links the executable into is three levels up.
    let Some(exe_dir) = PathBuf::from(required_env("OUT_DIR"))
        .ancestors()
        .nth(3)
        .map(Path::to_path_buf)
    else {
        return;
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.starts_with("libcrypto-") || !name.ends_with(".dll") {
            continue;
        }
        let destination = exe_dir.join(name);
        if destination.exists() {
            continue;
        }
        if let Err(error) = fs::copy(entry.path(), &destination) {
            warn(&format!(
                "Could not copy {name} next to the executable ({error}); add {} to PATH if the app fails to start.",
                bin_dir.display()
            ));
        }
    }
}

// ---------------------------------------------------------------------------
// Cargo plumbing
// ---------------------------------------------------------------------------

fn emit_rerun_triggers(repo_root: &Path) {
    println!(
        "cargo:rerun-if-changed={}",
        repo_root.join("CMakeLists.txt").display()
    );
    // Watched recursively: any change to a core source, header or the ABI shim
    // has to rebuild the archives this crate links against.
    println!("cargo:rerun-if-changed={}", repo_root.join("core").display());
    println!("cargo:rerun-if-changed=build.rs");

    for variable in [
        "BUFFERX_OPENSSL_LIB_DIR",
        "BUFFERX_OPENSSL_LIB_NAME",
        "BUFFERX_CORE_PROFILE",
        "OPENSSL_ROOT_DIR",
        "VCPKG_ROOT",
        "VCPKG_TARGET_TRIPLET",
    ] {
        println!("cargo:rerun-if-env-changed={variable}");
    }
}

/// CMake mishandles backslashes in `-D` values, so every path handed to it goes
/// through here.
fn cmake_path(path: &Path) -> String {
    path.display().to_string().replace('\\', "/")
}

fn required_env(name: &str) -> String {
    match env::var(name) {
        Ok(value) => value,
        Err(_) => fail(&format!(
            "{name} is not set. This script must be run by cargo as a build script."
        )),
    }
}

fn non_empty_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn env_dir(name: &str) -> Option<PathBuf> {
    non_empty_env(name).map(PathBuf::from).filter(|path| path.is_dir())
}

fn describe_env(name: &str) -> String {
    match non_empty_env(name) {
        Some(value) => format!("= {value}"),
        None => "(not set)".to_string(),
    }
}

fn first_existing_dir(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.is_dir()).cloned()
}

fn warn(message: &str) {
    // One line per call: cargo renders embedded newlines badly.
    println!("cargo:warning={message}");
}

fn fail(message: &str) -> ! {
    panic!("{message}");
}
