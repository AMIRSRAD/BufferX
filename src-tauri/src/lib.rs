//! The BufferX desktop shell.
//!
//! This crate is deliberately thin. All banking behaviour — ISO 8583, MAC, PIN
//! block, symmetric and RSA cryptography, TLV, IranSystem — lives in the C++
//! core and is reached through one JSON-in/JSON-out entry point (see
//! [`engine`]). Everything the shell adds is what a browser tab cannot do:
//! raw outbound TCP and arbitrary-path file access (see [`host`]).
//!
//! Keeping the split this sharp is what lets the same frontend run against the
//! WebAssembly build of the core with no behavioural drift: the web build simply
//! lacks the host commands and hides the panels that need them.
//!
//! Nothing in this crate logs command arguments. Requests carry PINs, PIN
//! blocks, symmetric keys and PEM private keys.

mod engine;
mod host;

use tauri::Manager;

/// Builds and runs the application, returning once the last window closes.
///
/// Startup failures are reported rather than unwrapped: a missing engine
/// session or a malformed generated context both surface as an `Err` that
/// [`crate::run`]'s caller turns into a non-zero exit.
fn build_and_run() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // One engine session for the whole process, opened before the
            // webview can issue its first invoke. A failure here is fatal:
            // without a session there is nothing for the UI to talk to, and a
            // window that renders but cannot compute anything is worse than a
            // clean refusal to start.
            let engine = engine::Engine::new()?;
            app.manage(engine);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine::engine_invoke,
            engine::engine_version,
            host::tcp_send,
            host::read_text_file,
            host::write_text_file,
            host::list_buffer_files,
            host::default_buffer_directory,
        ])
        .run(tauri::generate_context!())?;

    Ok(())
}

/// Entry point shared by the desktop binary and the mobile entry point.
///
/// Runs the app, and on a fatal startup error writes one line to stderr and
/// exits non-zero. The release binary has no console, so this line is for the
/// developer running it from a terminal; the user-visible failure is simply
/// that no window appears.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = build_and_run() {
        eprintln!("BufferX failed to start: {error}");
        std::process::exit(1);
    }
}
