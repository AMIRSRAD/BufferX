#![cfg_attr(windows, windows_subsystem = "windows")]
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        #[cfg(windows)]
        Some("error-mode") => {
            use windows_sys::Win32::System::Diagnostics::Debug::{
                GetErrorMode, SEM_FAILCRITICALERRORS, SEM_NOGPFAULTERRORBOX, SEM_NOOPENFILEERRORBOX,
            };
            let flags = SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX;
            std::process::exit(if unsafe { GetErrorMode() } & flags == flags {
                10
            } else {
                0
            });
        }
        Some("hang") => std::thread::sleep(std::time::Duration::from_secs(30)),
        Some("exit") => std::process::exit(7),
        Some("tree") => {
            let child = std::process::Command::new(std::env::current_exe().unwrap())
                .arg("hang")
                .spawn()
                .unwrap();
            std::fs::write(&args[1], child.id().to_string()).unwrap();
            std::thread::sleep(std::time::Duration::from_secs(30));
        }
        _ => std::process::exit(bufferx_startup_policy::fixture_exit(&args[0], &args[1])),
    }
}
