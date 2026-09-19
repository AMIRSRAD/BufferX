// BufferX desktop binary.
//
// Everything lives in the library crate so the mobile targets, the integration
// tests, and this binary all share one definition of the app. This file exists
// only to be an entry point.
//
// The release build is a Windows GUI subsystem binary: no console window flashes
// up behind the app. Debug builds keep the console so `println!` and panics from
// a `cargo run` are visible.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    bufferx_lib::run();
}
