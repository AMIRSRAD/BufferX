use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

pub(crate) fn helper_blocks(helper: &Path, current: &str, budget: Duration) -> bool {
    if !helper.is_absolute() {
        return false;
    }
    let mut command = Command::new(helper);
    command.arg(current);
    command_blocks(&mut command, budget)
}

pub(crate) fn command_blocks(command: &mut Command, budget: Duration) -> bool {
    let started = Instant::now();
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::System::Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED};
        // Attach the suspended child to its job before it can create descendants.
        command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let Ok(mut child) = spawn_quiet(command) else {
        return false;
    };
    let Some(tree) = ProcessTree::attach(&child) else {
        let _ = child.kill();
        let _ = child.wait();
        return false;
    };
    #[cfg(windows)]
    if !resume_child(&child) {
        drop(tree);
        let _ = child.wait();
        return false;
    }
    let blocked = loop {
        if started.elapsed() >= budget {
            break false;
        }
        match child.try_wait() {
            Ok(Some(status)) => break status.code() == Some(10),
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => break false,
        }
    };
    drop(tree); // Always terminate the entire tree, including on a successful exit.
    let _ = child.kill();
    let _ = child.wait();
    blocked
}

#[cfg(windows)]
fn spawn_quiet(command: &mut Command) -> std::io::Result<Child> {
    use windows_sys::Win32::System::Diagnostics::Debug::{
        GetErrorMode, SetErrorMode, SEM_FAILCRITICALERRORS, SEM_NOGPFAULTERRORBOX,
        SEM_NOOPENFILEERRORBOX,
    };
    static SPAWN_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _lock = SPAWN_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    // Child error modes are inherited. Suppress loader/crash dialogs only during
    // creation, then immediately restore the app's original mode.
    unsafe {
        let previous = SetErrorMode(
            GetErrorMode()
                | SEM_FAILCRITICALERRORS
                | SEM_NOGPFAULTERRORBOX
                | SEM_NOOPENFILEERRORBOX,
        );
        let child = command.spawn();
        SetErrorMode(previous);
        child
    }
}

#[cfg(not(windows))]
fn spawn_quiet(command: &mut Command) -> std::io::Result<Child> {
    command.spawn()
}

#[cfg(windows)]
fn resume_child(child: &Child) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::*;
    use windows_sys::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut entry: THREADENTRY32 = std::mem::zeroed();
        entry.dwSize = std::mem::size_of_val(&entry) as u32;
        let mut found = Thread32First(snapshot, &mut entry);
        let mut resumed = false;
        while found != 0 {
            if entry.th32OwnerProcessID == child.id() {
                let handle = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
                if !handle.is_null() {
                    resumed = ResumeThread(handle) != u32::MAX;
                    CloseHandle(handle);
                }
                break;
            }
            found = Thread32Next(snapshot, &mut entry);
        }
        CloseHandle(snapshot);
        resumed
    }
}

#[cfg(windows)]
struct ProcessTree(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl ProcessTree {
    fn attach(child: &Child) -> Option<Self> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return None;
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, child.as_raw_handle()) == 0
            {
                CloseHandle(handle);
                return None;
            }
            Some(Self(handle))
        }
    }
}
#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(unix)]
struct ProcessTree(i32);
#[cfg(unix)]
impl ProcessTree {
    fn attach(child: &Child) -> Option<Self> {
        Some(Self(child.id() as i32))
    }
}
#[cfg(unix)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            libc::kill(-self.0, libc::SIGKILL);
        }
    }
}
