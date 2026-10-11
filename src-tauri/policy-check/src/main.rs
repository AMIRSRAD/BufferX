#![cfg_attr(windows, windows_subsystem = "windows")]
#[cfg(feature = "test-fixtures")]
compile_error!("A production checker must never be built with test-fixtures enabled.");

fn main() {
    let mut arguments = std::env::args().skip(1);
    let current = arguments.next().unwrap_or_default();
    if arguments.next().is_some() {
        std::process::exit(0);
    }
    std::process::exit(bufferx_startup_policy::checker_exit(&current));
}
