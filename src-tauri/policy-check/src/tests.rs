use super::*;
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};
use std::thread;
use std::time::Instant;

struct Server {
    url: String,
    received: mpsc::Receiver<String>,
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}
impl Server {
    fn with(handler: impl FnOnce(TcpStream) + Send + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!(
            "http://{}/startup-policy.json",
            listener.local_addr().unwrap()
        );
        let (sender, received) = mpsc::channel();
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let worker = thread::spawn(move || {
            while !stopped.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        // Windows inherits the listener's nonblocking mode on accept.
                        stream.set_nonblocking(false).unwrap();
                        stream
                            .set_read_timeout(Some(Duration::from_secs(3)))
                            .unwrap();
                        let mut request = Vec::new();
                        let mut chunk = [0; 4096];
                        while !request.ends_with(b"\r\n\r\n") {
                            let count = stream.read(&mut chunk).unwrap_or(0);
                            if count == 0 || request.len() > MAX_BODY {
                                break;
                            }
                            request.extend_from_slice(&chunk[..count]);
                        }
                        // Ignore connection-only probes from local tooling. They are not
                        // the policy request and must not consume this one-shot fixture.
                        if !request.starts_with(b"GET /startup-policy.json ")
                            || !request.ends_with(b"\r\n\r\n")
                        {
                            continue;
                        }
                        let _ = sender.send(String::from_utf8_lossy(&request).into_owned());
                        handler(stream);
                        break;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5))
                    }
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::ConnectionAborted
                                | std::io::ErrorKind::ConnectionReset
                                | std::io::ErrorKind::Interrupted
                        ) =>
                    {
                        continue
                    }
                    Err(error) => panic!("Loopback accept failed: {error:?}"),
                }
            }
        });
        Self {
            url,
            received,
            stop,
            worker: Some(worker),
        }
    }
    fn raw(response: String) -> Self {
        Self::with(move |mut stream| {
            let _ = stream.write_all(response.as_bytes());
        })
    }
    fn body(body: &str) -> Self {
        Self::raw(format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ))
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.worker.take().unwrap().join().unwrap();
    }
}

const ALLOW: &str = r#"{"schemaVersion":1,"product":"BufferX","updateRequired":false}"#;
const BLOCK: &str = r#"{"schemaVersion":1,"product":"BufferX","updateRequired":true}"#;

fn fixture() -> std::path::PathBuf {
    let path = std::env::var_os("BUFFERX_TEST_HELPER")
        .expect("Run scripts/verify-startup-policy.ps1 to build the isolated fixture first");
    let path = std::path::PathBuf::from(path);
    assert!(path.is_absolute() && path.is_file());
    path
}
fn secondary(endpoint: &str) -> bool {
    process::command_blocks(
        Command::new(fixture()).arg(endpoint).arg("2.0.0"),
        HELPER_BUDGET,
    )
}
fn refused() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    format!("http://{}/policy", listener.local_addr().unwrap())
}

#[test]
fn policy_parser_is_strict_and_versions_are_numeric() {
    assert!(blocks(BLOCK.as_bytes(), "2.0.0"));
    assert!(!blocks(ALLOW.as_bytes(), "2.0.0"));
    for text in [
        "2",
        "2.0",
        "2.0.0.0",
        "2.0.0.1",
        "2.0.a",
        "-1.0.0",
        "2.0.0-beta",
        " 2.0.0",
    ] {
        assert!(!blocks(BLOCK.as_bytes(), text), "{text}");
    }
    let policy = |minimum: &str| {
        format!(
            r#"{{"schemaVersion":1,"product":"BufferX","updateRequired":false,"minimumSupportedVersion":"{minimum}"}}"#
        )
    };
    assert!(blocks(policy("2.10.0").as_bytes(), "2.9.0"));
    assert!(!blocks(policy("2.9.0").as_bytes(), "2.10.0"));
}

#[test]
fn primary_and_separate_secondary_compose_and_short_circuit() {
    for (primary_body, secondary_body, expected, secondary_called) in [
        (ALLOW, ALLOW, false, true),
        (ALLOW, BLOCK, true, true),
        (BLOCK, ALLOW, true, false),
        (BLOCK, BLOCK, true, false),
        ("not json", BLOCK, true, true),
        (ALLOW, "not json", false, true),
    ] {
        let primary = Server::body(primary_body);
        let helper = Server::body(secondary_body);
        let actual = evaluate(&primary.url, "2.0.0", || secondary(&helper.url));
        assert_eq!(actual, expected, "Primary {primary_body}; secondary {secondary_body}; primary request: {:?}; helper request: {:?}", primary.received.try_recv(), helper.received.try_recv());
        assert_eq!(helper.received.try_recv().is_ok(), secondary_called);
        let headers = primary.received.recv().unwrap().to_lowercase();
        let values: std::collections::HashMap<_, _> = headers
            .lines()
            .filter_map(|line| {
                line.split_once(':')
                    .map(|(name, value)| (name, value.trim()))
            })
            .collect();
        assert_eq!(
            values.get("accept"),
            Some(&"application/json"),
            "{headers:?}"
        );
        assert_eq!(values.get("cache-control"), Some(&"no-cache, no-store"));
        assert_eq!(values.get("user-agent"), Some(&"bufferx/2.0.0"));
    }
}

#[test]
fn unavailable_hosts_do_not_cache_or_prevent_startup() {
    for secondary_body in [ALLOW, BLOCK] {
        let helper = Server::body(secondary_body);
        assert_eq!(
            evaluate(&refused(), "2.0.0", || secondary(&helper.url)),
            secondary_body == BLOCK
        );
    }
    let primary = Server::body(ALLOW);
    assert!(!evaluate(&primary.url, "2.0.0", || secondary(&refused())));
    assert!(!evaluate(&refused(), "2.0.0", || secondary(&refused())));
    let primary = Server::body(BLOCK);
    assert!(evaluate(&primary.url, "2.0.0", || panic!(
        "Primary block must short circuit"
    )));
    assert!(!evaluate(&refused(), "2.0.0", || secondary(&refused())));
}

#[test]
fn malformed_secondary_responses_fail_open() {
    for body in [
        "",
        "{",
        "null",
        "[]",
        "{}",
        r#"{"schemaVersion":1,"product":"bufferx","updateRequired":true}"#,
        r#"{"schemaVersion":2,"product":"BufferX","updateRequired":true}"#,
        r#"{"schemaVersion":"1","product":"BufferX","updateRequired":true}"#,
        r#"{"schemaVersion":1.0,"product":"BufferX","updateRequired":true}"#,
        r#"{"schemaVersion":1,"product":3,"updateRequired":true}"#,
        r#"{"schemaVersion":1,"product":"BufferX","updateRequired":"true"}"#,
        r#"{"schemaVersion":1,"product":"BufferX","updateRequired":true,"minimumSupportedVersion":null}"#,
        r#"{"schemaVersion":1,"product":"BufferX","updateRequired":true,"minimumSupportedVersion":3}"#,
        r#"{"schemaVersion":1,"product":"BufferX","updateRequired":true,"minimumSupportedVersion":"2.0"}"#,
    ] {
        let helper = Server::body(body);
        assert!(!secondary(&helper.url), "Invalid body blocked: {body}");
    }
}

#[test]
fn minimum_versions_and_unknown_fields_work_in_both_processes() {
    for (body, expected) in [
        (
            r#"{"schemaVersion":1,"product":"BufferX","updateRequired":false,"minimumSupportedVersion":"2.0.1"}"#,
            true,
        ),
        (
            r#"{"schemaVersion":1,"product":"BufferX","updateRequired":false,"minimumSupportedVersion":"2.0.0"}"#,
            false,
        ),
        (
            r#"{"schemaVersion":1,"product":"BufferX","updateRequired":false,"minimumSupportedVersion":"1.9.9"}"#,
            false,
        ),
        (
            r#"{"schemaVersion":1,"product":"BufferX","updateRequired":true,"minimumSupportedVersion":"1.0.0","extra":42}"#,
            true,
        ),
    ] {
        let primary = Server::body(body);
        assert_eq!(
            evaluate(&primary.url, "2.0.0", || false),
            expected,
            "Primary policy: {body}"
        );
        let helper = Server::body(body);
        assert_eq!(secondary(&helper.url), expected, "Secondary policy: {body}");
    }
}

#[test]
fn http_failures_redirects_and_incomplete_bodies_fail_open() {
    for response in [
        format!(
            "HTTP/1.1 404 Not Found\r\nContent-Length: {}\r\n\r\n{BLOCK}",
            BLOCK.len()
        ),
        format!(
            "HTTP/1.1 500 Error\r\nContent-Length: {}\r\n\r\n{BLOCK}",
            BLOCK.len()
        ),
        format!("HTTP/1.1 200 OK\r\nContent-Length: 999\r\n\r\n{BLOCK}"),
        format!("HTTP/1.1 200 OK\r\nContent-Length: 20000\r\n\r\n{BLOCK}"),
        format!(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{}\r\n0\r\n\r\n",
            MAX_BODY + 1,
            format!("{BLOCK}{}", " ".repeat(MAX_BODY + 1 - BLOCK.len()))
        ),
    ] {
        let primary = Server::raw(response.clone());
        assert!(!check_url(&primary.url, "2.0.0"));
        let helper = Server::raw(response);
        assert!(!secondary(&helper.url));
    }
    let destination = Server::body(BLOCK);
    let redirect = || {
        Server::raw(format!(
            "HTTP/1.1 302 Found\r\nLocation: {}\r\nContent-Length: {}\r\n\r\n{BLOCK}",
            destination.url,
            BLOCK.len()
        ))
    };
    assert!(!check_url(&redirect().url, "2.0.0"));
    assert!(!secondary(&redirect().url));
    assert!(destination.received.try_recv().is_err());
}

fn slow() -> Server {
    Server::with(|mut stream| {
        thread::sleep(Duration::from_millis(2300));
        let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
    })
}

#[test]
fn request_deadlines_cover_primary_secondary_and_streaming_body() {
    let primary = slow();
    let helper = Server::body(BLOCK);
    let start = Instant::now();
    assert!(evaluate(&primary.url, "2.0.0", || secondary(&helper.url)));
    assert!(
        start.elapsed() < Duration::from_millis(5500),
        "Primary plus helper took {:?}",
        start.elapsed()
    );
    let helper = slow();
    let start = Instant::now();
    assert!(!secondary(&helper.url));
    assert!(
        start.elapsed() < Duration::from_millis(3500),
        "Helper took {:?}",
        start.elapsed()
    );
    let primary = slow();
    let helper = slow();
    let start = Instant::now();
    assert!(!evaluate(&primary.url, "2.0.0", || secondary(&helper.url)));
    assert!(
        start.elapsed() < Duration::from_millis(5500),
        "Both requests took {:?}",
        start.elapsed()
    );
    let streaming = Server::with(|mut stream| {
        let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 60\r\n\r\n");
        for _ in 0..30 {
            thread::sleep(Duration::from_millis(100));
            if stream.write_all(b" ").is_err() {
                break;
            }
        }
    });
    let start = Instant::now();
    assert!(!secondary(&streaming.url));
    assert!(
        start.elapsed() < Duration::from_millis(3500),
        "Streaming body took {:?}",
        start.elapsed()
    );
}

#[test]
fn missing_failed_and_hung_helpers_fail_open_and_are_reaped() {
    assert!(!process::helper_blocks(
        &fixture().with_file_name("missing-helper.exe"),
        "2.0.0",
        HELPER_BUDGET
    ));
    assert!(!process::command_blocks(
        Command::new(fixture()).arg("exit"),
        HELPER_BUDGET
    ));
    let start = Instant::now();
    assert!(!process::command_blocks(
        Command::new(fixture()).arg("hang"),
        HELPER_BUDGET
    ));
    assert!(start.elapsed() < Duration::from_millis(3500));
}

#[cfg(windows)]
#[test]
fn helper_inherits_no_error_dialog_mode_and_parent_mode_is_restored() {
    use windows_sys::Win32::System::Diagnostics::Debug::GetErrorMode;
    let original = unsafe { GetErrorMode() };
    assert!(process::command_blocks(
        Command::new(fixture()).arg("error-mode"),
        HELPER_BUDGET
    ));
    assert_eq!(unsafe { GetErrorMode() }, original);
}

#[cfg(windows)]
#[test]
fn a_hung_helper_tree_is_killed() {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };
    let pid_file =
        std::env::temp_dir().join(format!("bufferx-policy-child-{}.txt", std::process::id()));
    assert!(!process::command_blocks(
        Command::new(fixture()).arg("tree").arg(&pid_file),
        HELPER_BUDGET
    ));
    let pid: u32 = std::fs::read_to_string(&pid_file).unwrap().parse().unwrap();
    unsafe {
        let handle = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if !handle.is_null() {
            assert_eq!(WaitForSingleObject(handle, 1000), WAIT_OBJECT_0);
            CloseHandle(handle);
        }
    }
    std::fs::remove_file(pid_file).unwrap();
}
