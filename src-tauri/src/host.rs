//! Host-only commands: the capabilities a browser tab cannot provide.
//!
//! Everything here is deliberately outside the engine contract's computational
//! core, because none of it can run in WebAssembly: raw outbound TCP to an ISO
//! 8583 host, and reading and writing arbitrary paths for PEM keys and saved
//! buffers. The web build hides the panels that need them.
//!
//! Payloads and file contents handled here are sensitive — an ISO buffer can
//! carry a PIN block and a key file is a private key. Neither is ever logged,
//! and neither ever appears in an error message.

use std::fs::{self, File};
use std::io::{ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::Path;
use std::time::{Duration, Instant};

use serde::Serialize;

/// Ceiling on how much of a peer's answer is buffered.
///
/// A framed response declares its own length, and a confused or hostile host
/// can declare a very large one. An ISO 8583 message is kilobytes; this leaves
/// four orders of magnitude of headroom and still cannot exhaust memory.
const MAX_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;

const MIN_TIMEOUT_MS: u64 = 100;
const MAX_TIMEOUT_MS: u64 = 120_000;
const MAX_ASCII_HEADER: usize = 8;
const MAX_BINARY_HEADER: usize = 4;

const HEADER_SIZE_ERROR: &str = "Header size must be 1-8 ASCII bytes or 1-4 binary bytes.";
const INVALID_ASCII_HEADER: &str = "Response has an invalid ASCII length header.";
const NO_DATA: &str = "TCP peer returned no data.";
const TRUNCATED: &str = "TCP response ended before the framed payload was complete.";
const READ_BUDGET_SPENT: &str = "TCP read failed or timed out: the time budget expired.";

/// Portable default: keep the library alongside the executable, regardless of cwd.
#[tauri::command]
pub async fn default_buffer_directory(create: Option<bool>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let executable = std::env::current_exe().map_err(|_| "Cannot locate the executable.".to_string())?;
        let parent = executable.parent().ok_or_else(|| "Cannot locate the executable folder.".to_string())?;
        let directory = parent.join("saved-buffers");
        if create.unwrap_or(true) {
            fs::create_dir_all(&directory).map_err(|_| "Cannot create saved-buffers beside the executable. Choose a writable folder in Settings → Buffers and session.".to_string())?;
        }
        Ok(directory.to_string_lossy().into_owned())
    }).await.map_err(|_| "Cannot prepare the saved buffers folder.".to_string())?
}

// ---------------------------------------------------------------------------
// TCP
// ---------------------------------------------------------------------------

/// How the body length is carried on the wire.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Framing {
    /// The body is sent raw. There is no length to read back, so the response
    /// ends when the peer closes the connection or the timeout expires.
    None,
    /// The body length as zero-padded ASCII decimal digits.
    Ascii,
    /// The body length as a big-endian integer.
    Binary,
}

impl Framing {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "none" => Ok(Self::None),
            "ascii" => Ok(Self::Ascii),
            "binary" => Ok(Self::Binary),
            _ => Err("TCP framing must be none, ascii, or binary.".to_string()),
        }
    }
}

/// One completed request/response exchange.
///
/// `requestHex` and `responseHex` are the **complete bytes on the wire**,
/// framing header included, and `bytesSent` / `bytesReceived` count those same
/// bytes. Callers that only want the body slice off `headerSize * 2` hex
/// characters; nothing is hidden from them.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TcpExchange {
    request_hex: String,
    response_hex: String,
    elapsed_ms: u64,
    bytes_sent: usize,
    bytes_received: usize,
}

/// Sends one framed request to a host and reads one framed response back.
///
/// `timeout_ms` is the budget for the whole exchange — address resolution,
/// connect, write and read all draw from it — so a peer that dribbles bytes
/// cannot hold the connection open indefinitely.
#[tauri::command]
pub async fn tcp_send(
    host: String,
    port: u32,
    payload_hex: String,
    framing: String,
    header_size: Option<usize>,
    timeout_ms: u64,
) -> Result<TcpExchange, String> {
    let framing = Framing::parse(&framing)?;

    let host = host.trim().to_string();
    if host.is_empty() {
        return Err("TCP host must not be empty.".to_string());
    }
    if port == 0 || port > u32::from(u16::MAX) {
        return Err("TCP port must be between 1 and 65535.".to_string());
    }
    let port = port as u16;

    if !(MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&timeout_ms) {
        return Err(format!(
            "TCP timeout must be between {MIN_TIMEOUT_MS} and {MAX_TIMEOUT_MS} ms."
        ));
    }

    let body = decode_hex(&payload_hex)?;
    if body.is_empty() {
        return Err("TCP request payload must not be empty.".to_string());
    }

    let header_size = resolve_header_size(framing, header_size)?;
    let request = frame_request(framing, header_size, &body)?;

    // Sockets block; the webview must not.
    tauri::async_runtime::spawn_blocking(move || {
        exchange(
            &host,
            port,
            framing,
            header_size,
            request,
            Duration::from_millis(timeout_ms),
        )
    })
    .await
    .map_err(|_| "The TCP exchange did not complete.".to_string())?
}

fn resolve_header_size(framing: Framing, header_size: Option<usize>) -> Result<usize, String> {
    let limit = match framing {
        Framing::None => return Ok(0),
        Framing::Ascii => MAX_ASCII_HEADER,
        Framing::Binary => MAX_BINARY_HEADER,
    };
    match header_size {
        Some(size) if (1..=limit).contains(&size) => Ok(size),
        _ => Err(HEADER_SIZE_ERROR.to_string()),
    }
}

fn frame_request(framing: Framing, header_size: usize, body: &[u8]) -> Result<Vec<u8>, String> {
    match framing {
        Framing::None => Ok(body.to_vec()),
        Framing::Ascii => {
            let digits = format!("{:0>width$}", body.len(), width = header_size);
            if digits.len() > header_size {
                return Err("Payload length does not fit the ASCII header.".to_string());
            }
            let mut wire = Vec::with_capacity(header_size + body.len());
            wire.extend_from_slice(digits.as_bytes());
            wire.extend_from_slice(body);
            Ok(wire)
        }
        Framing::Binary => {
            let length = body.len() as u64;
            if length >= 1u64 << (8 * header_size) {
                return Err("Payload length does not fit the binary header.".to_string());
            }
            let mut wire = Vec::with_capacity(header_size + body.len());
            for shift in (0..header_size).rev() {
                wire.push(((length >> (8 * shift)) & 0xFF) as u8);
            }
            wire.extend_from_slice(body);
            Ok(wire)
        }
    }
}

fn exchange(
    host: &str,
    port: u16,
    framing: Framing,
    header_size: usize,
    request: Vec<u8>,
    timeout: Duration,
) -> Result<TcpExchange, String> {
    let started = Instant::now();
    let deadline = started + timeout;

    let mut stream = connect(host, port, deadline)?;
    // A request/response tester wants the message out now, not coalesced.
    let _ = stream.set_nodelay(true);

    apply_deadline(&stream, deadline)?;
    let mut written = 0;
    while written < request.len() {
        apply_deadline(&stream, deadline)?;
        match stream.write(&request[written..]) {
            Ok(0) => return Err("TCP write failed: the peer closed the connection.".to_string()),
            Ok(count) => written += count,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => return Err(format!("TCP write failed: {error}")),
        }
    }
    stream
        .flush()
        .map_err(|error| format!("TCP write failed: {error}"))?;

    apply_deadline(&stream, deadline)?;
    let response = match framing {
        Framing::None => read_until_close(&mut stream, deadline)?,
        Framing::Ascii | Framing::Binary => read_framed(&mut stream, framing, header_size, deadline)?,
    };

    Ok(TcpExchange {
        request_hex: to_hex(&request),
        response_hex: to_hex(&response),
        elapsed_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        bytes_sent: request.len(),
        bytes_received: response.len(),
    })
}

fn connect(host: &str, port: u16, deadline: Instant) -> Result<TcpStream, String> {
    let host = host.strip_prefix('[').and_then(|value| value.strip_suffix(']')).unwrap_or(host);
    // Resolution is the one step with no timeout of its own; the budget is
    // re-checked before each connect attempt so a slow resolver still bounds
    // the whole call.
    let addresses: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("TCP connect failed: {error}"))?
        .collect();

    if addresses.is_empty() {
        return Err(format!("TCP connect failed: {host} did not resolve to an address."));
    }

    let mut last_error = String::new();
    for address in &addresses {
        let remaining = remaining(deadline).map_err(|_| {
            format!("TCP connect failed: the time budget expired before reaching {host}.")
        })?;
        match TcpStream::connect_timeout(address, remaining) {
            Ok(stream) => return Ok(stream),
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(format!("TCP connect failed: {last_error}"))
}

/// Re-arms the socket's read and write timeouts with whatever is left of the
/// budget, so no single syscall can outlive the deadline.
fn apply_deadline(stream: &TcpStream, deadline: Instant) -> Result<(), String> {
    let remaining = remaining(deadline)?;
    stream
        .set_read_timeout(Some(remaining))
        .map_err(|error| format!("TCP socket setup failed: {error}"))?;
    stream
        .set_write_timeout(Some(remaining))
        .map_err(|error| format!("TCP socket setup failed: {error}"))?;
    Ok(())
}

fn remaining(deadline: Instant) -> Result<Duration, String> {
    let left = deadline.saturating_duration_since(Instant::now());
    if left.is_zero() {
        return Err(READ_BUDGET_SPENT.to_string());
    }
    Ok(left)
}

/// Reads a header, learns the body length from it, then reads exactly that
/// many bytes. Returns header and body together, as they arrived.
fn read_framed(stream: &mut TcpStream, framing: Framing, header_size: usize, deadline: Instant) -> Result<Vec<u8>, String> {
    let mut response = vec![0u8; header_size];
    read_exactly(stream, &mut response, true, deadline)?;

    let body_length = match framing {
        Framing::Ascii => {
            if !response.iter().all(u8::is_ascii_digit) {
                return Err(INVALID_ASCII_HEADER.to_string());
            }
            std::str::from_utf8(&response)
                .ok()
                .and_then(|digits| digits.parse::<u64>().ok())
                .ok_or_else(|| INVALID_ASCII_HEADER.to_string())?
        }
        // header_size is at most 4 here, so this cannot overflow.
        Framing::Binary => response
            .iter()
            .fold(0u64, |value, byte| (value << 8) | u64::from(*byte)),
        Framing::None => 0,
    };

    if body_length > MAX_RESPONSE_BYTES {
        return Err(format!(
            "TCP response header declares {body_length} bytes, above the {MAX_RESPONSE_BYTES} byte limit."
        ));
    }

    if body_length > 0 {
        let mut body = vec![0u8; body_length as usize];
        read_exactly(stream, &mut body, false, deadline)?;
        response.extend_from_slice(&body);
    }
    Ok(response)
}

fn read_exactly(stream: &mut TcpStream, buffer: &mut [u8], is_header: bool, deadline: Instant) -> Result<(), String> {
    let mut filled = 0;
    while filled < buffer.len() {
        apply_deadline(stream, deadline)?;
        match stream.read(&mut buffer[filled..]) {
            Ok(0) => {
                return Err(if is_header && filled == 0 {
                    NO_DATA.to_string()
                } else {
                    TRUNCATED.to_string()
                })
            }
            Ok(read) => filled += read,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => return Err(format!("TCP read failed or timed out: {error}")),
        }
    }
    Ok(())
}

/// Unframed reads have no length to wait for, so the response is whatever
/// arrives before the peer closes the connection or the budget runs out. The
/// socket timeout set by `apply_deadline` is what ends the wait.
fn read_until_close(stream: &mut TcpStream, deadline: Instant) -> Result<Vec<u8>, String> {
    let mut response = Vec::new();
    let mut chunk = [0u8; 8192];

    loop {
        if let Err(error) = apply_deadline(stream, deadline) {
            if response.is_empty() { return Err(error); }
            break;
        }
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                if response.len() as u64 + read as u64 > MAX_RESPONSE_BYTES {
                    return Err(format!(
                        "TCP response exceeded the {MAX_RESPONSE_BYTES} byte limit."
                    ));
                }
                response.extend_from_slice(&chunk[..read]);
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) if is_timeout(&error) => {
                // A timeout after the peer has spoken is the normal end of an
                // unframed exchange; a timeout before it is a failure.
                if response.is_empty() {
                    return Err(format!("TCP read failed or timed out: {error}"));
                }
                break;
            }
            Err(error) => return Err(format!("TCP read failed or timed out: {error}")),
        }
    }

    if response.is_empty() {
        return Err(NO_DATA.to_string());
    }
    Ok(response)
}

fn is_timeout(error: &std::io::Error) -> bool {
    // Windows reports a socket read timeout as TimedOut, Unix as WouldBlock.
    matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut)
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/// Reads a UTF-8 text file: PEM keys, packager XML, saved buffer documents.
///
/// The contents may be a private key. They are returned to the caller and
/// nowhere else, and never appear in an error message.
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_text(&path))
        .await
        .map_err(|_| "The file read did not complete.".to_string())?
}

/// Writes a UTF-8 text file, checking every step.
///
/// Write, flush and sync are each verified before reporting success. The
/// version of this that only checked whether the file *opened* reported saves
/// that never landed.
#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_text(&path, &contents))
        .await
        .map_err(|_| "The file write did not complete.".to_string())?
}

/// One saved-buffer file in the library folder.
#[derive(serde::Serialize)]
pub struct LibraryEntry {
    /// File name including extension, e.g. `0200-purchase.bxb`.
    pub name: String,
    /// Absolute path, used to reopen the file.
    pub path: String,
    pub size: u64,
    /// Last-modified time in milliseconds since the Unix epoch, or 0 if the
    /// platform does not report one.
    pub modified: u64,
}

/// Lists the saved-buffer documents in one folder.
///
/// The library deliberately stores buffer *content* in the operator's own files
/// rather than in application storage: a saved message carries a PAN, track 2
/// data and a PIN block, and those belong somewhere the operator already
/// controls retention and encryption for.
///
/// Non-recursive and extension-filtered, so pointing this at a large directory
/// cannot turn into a filesystem walk. Unreadable entries are skipped rather
/// than failing the whole listing — one bad file should not hide the library.
#[tauri::command]
pub async fn list_buffer_files(
    directory: String,
    extension: String,
) -> Result<Vec<LibraryEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || list_files(&directory, &extension))
        .await
        .map_err(|_| "The directory listing did not complete.".to_string())?
}

fn list_files(directory: &str, extension: &str) -> Result<Vec<LibraryEntry>, String> {
    let dir = Path::new(directory);
    if !dir.is_dir() {
        return Err(format!("{directory} is not a folder."));
    }

    let wanted = extension.trim_start_matches('.').to_ascii_lowercase();
    let entries = fs::read_dir(dir)
        .map_err(|error| format!("Failed to read folder {directory}: {error}"))?;

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let matches = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase() == wanted)
            .unwrap_or(false);
        if !matches {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|delta| delta.as_millis() as u64)
            .unwrap_or(0);

        out.push(LibraryEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            size: metadata.len(),
            modified,
        });
    }

    // Newest first; the file just saved should be at the top.
    out.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.name.cmp(&b.name)));
    Ok(out)
}

fn read_text(path: &str) -> Result<String, String> {
    let bytes =
        fs::read(Path::new(path)).map_err(|error| format!("Failed to open file {path}: {error}"))?;

    // Editors on Windows habitually prefix a BOM; a PEM header or an XML
    // declaration must not inherit it.
    let bytes = match bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        Some(rest) => rest.to_vec(),
        None => bytes,
    };

    String::from_utf8(bytes).map_err(|_| format!("{path} is not valid UTF-8 text."))
}

fn write_text(path: &str, contents: &str) -> Result<(), String> {
    let path = Path::new(path);

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err(format!(
                "Failed to save to {}: the containing folder does not exist.",
                path.display()
            ));
        }
    }

    let mut file =
        File::create(path).map_err(|error| format!("Failed to save to {}: {error}", path.display()))?;
    file.write_all(contents.as_bytes())
        .map_err(|error| format!("Failed to save to {}: {error}", path.display()))?;
    file.flush()
        .map_err(|error| format!("Failed to save to {}: {error}", path.display()))?;
    file.sync_all()
        .map_err(|error| format!("Failed to save to {}: {error}", path.display()))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Hex
// ---------------------------------------------------------------------------

const HEX_DIGITS: &[u8; 16] = b"0123456789ABCDEF";

/// Parses hex text the way every other BufferX surface does: whitespace is
/// skipped, both cases accepted, and the two failure messages are the ones the
/// engine contract pins.
fn decode_hex(text: &str) -> Result<Vec<u8>, String> {
    let mut nibbles: Vec<u8> = Vec::with_capacity(text.len());
    for character in text.chars() {
        if character.is_whitespace() {
            continue;
        }
        match character.to_digit(16) {
            Some(value) => nibbles.push(value as u8),
            None => return Err("Invalid hex character.".to_string()),
        }
    }
    if nibbles.len() % 2 != 0 {
        return Err("Odd number of hex digits.".to_string());
    }
    Ok(nibbles.chunks(2).map(|pair| (pair[0] << 4) | pair[1]).collect())
}

/// Uppercase, no separators — the house `HexCompact` rendering.
fn to_hex(bytes: &[u8]) -> String {
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        text.push(HEX_DIGITS[usize::from(byte >> 4)] as char);
        text.push(HEX_DIGITS[usize::from(byte & 0x0F)] as char);
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    fn mock_peer(request: Vec<u8>, chunks: Vec<Vec<u8>>, delay: Duration) -> (u16, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let worker = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut actual = vec![0; request.len()];
            socket.read_exact(&mut actual).unwrap();
            assert_eq!(actual, request);
            for chunk in chunks {
                if !delay.is_zero() { thread::sleep(delay); }
                if socket.write_all(&chunk).is_err() { break; }
            }
        });
        (port, worker)
    }

    #[test]
    fn loopback_exchanges_all_framings_and_fragmented_responses() {
        for (framing, width) in [(Framing::None, 0), (Framing::Ascii, 4), (Framing::Binary, 2)] {
            let request = frame_request(framing, width, &[2, 0]).unwrap();
            let response = frame_request(framing, width, &[2, 0x10, 0xff]).unwrap();
            let chunks = response.iter().map(|byte| vec![*byte]).collect();
            let (port, peer) = mock_peer(request.clone(), chunks, Duration::from_millis(2));
            let result = exchange("127.0.0.1", port, framing, width, request.clone(), Duration::from_secs(2)).unwrap();
            assert_eq!(result.request_hex, to_hex(&request));
            assert_eq!(result.response_hex, to_hex(&response));
            assert_eq!(result.bytes_sent, request.len());
            assert_eq!(result.bytes_received, response.len());
            peer.join().unwrap();
        }
    }

    #[test]
    fn loopback_rejects_bad_headers_short_reads_and_oversized_responses() {
        for (framing, width, response, expected) in [
            (Framing::Ascii, 4, b"00X2AB".to_vec(), INVALID_ASCII_HEADER),
            (Framing::Ascii, 4, b"0005AB".to_vec(), TRUNCATED),
            (Framing::Binary, 2, vec![0], TRUNCATED),
            (Framing::Ascii, 8, b"99999999".to_vec(), "above the"),
            (Framing::None, 0, vec![], NO_DATA),
        ] {
            let request = frame_request(framing, width, &[1]).unwrap();
            let (port, peer) = mock_peer(request.clone(), vec![response], Duration::ZERO);
            let result = exchange("127.0.0.1", port, framing, width, request, Duration::from_secs(2));
            assert!(result.err().unwrap().contains(expected));
            peer.join().unwrap();
        }
    }

    #[test]
    fn a_dribbling_peer_cannot_extend_the_total_read_budget() {
        let request = frame_request(Framing::Ascii, 4, &[1]).unwrap();
        let mut chunks = vec![b"0020".to_vec()];
        chunks.extend((0..20).map(|_| vec![0x41]));
        let (port, peer) = mock_peer(request.clone(), chunks, Duration::from_millis(40));
        let started = Instant::now();
        let error = exchange("127.0.0.1", port, Framing::Ascii, 4, request, Duration::from_millis(160)).err().unwrap();
        assert!(error.contains("timed out") || error.contains("budget expired"));
        assert!(started.elapsed() < Duration::from_millis(550));
        peer.join().unwrap();
    }

    #[test]
    fn unframed_read_returns_received_bytes_when_budget_expires() {
        let (port, peer) = mock_peer(vec![1], vec![vec![0x41]; 20], Duration::from_millis(40));
        let started = Instant::now();
        let result = exchange("127.0.0.1", port, Framing::None, 0, vec![1], Duration::from_millis(160)).unwrap();
        assert!(result.bytes_received > 0 && result.bytes_received < 20);
        assert!(started.elapsed() < Duration::from_millis(550));
        peer.join().unwrap();
    }

    #[test]
    fn bracketed_ipv6_literal_connects() {
        let Ok(listener) = TcpListener::bind("[::1]:0") else { return; };
        let port = listener.local_addr().unwrap().port();
        let worker = thread::spawn(move || listener.accept().unwrap());
        let socket = connect("[::1]", port, Instant::now() + Duration::from_secs(2)).unwrap();
        drop(socket); drop(worker.join().unwrap());
    }

    #[test]
    fn ascii_framing_matches_the_pinned_vector() {
        // The header counts BODY BYTES, not payload characters. Hex "0200" is
        // two bytes, so a 4-digit header reads "0002" — bytes 30 30 30 32 —
        // followed by the body 02 00. Getting this wrong by counting hex
        // characters instead is the classic way to desynchronize an ISO host.
        let body = decode_hex("0200").expect("valid hex");
        assert_eq!(body.len(), 2);
        let wire = frame_request(Framing::Ascii, 4, &body).expect("fits the header");
        assert_eq!(to_hex(&wire), "303030320200");
    }

    #[test]
    fn binary_framing_prefixes_a_big_endian_length() {
        let body = decode_hex("0200").expect("valid hex");
        let wire = frame_request(Framing::Binary, 2, &body).expect("fits the header");
        assert_eq!(to_hex(&wire), "00020200");
    }

    #[test]
    fn no_framing_sends_the_body_untouched() {
        let body = decode_hex("02 00 FF").expect("valid hex");
        let wire = frame_request(Framing::None, 0, &body).expect("no header to fit");
        assert_eq!(to_hex(&wire), "0200FF");
    }

    #[test]
    fn oversized_bodies_are_rejected_by_both_headers() {
        let body = vec![0u8; 1000];
        assert!(frame_request(Framing::Ascii, 2, &body).is_err());
        assert!(frame_request(Framing::Binary, 1, &body).is_err());
        assert!(frame_request(Framing::Ascii, 4, &body).is_ok());
        assert!(frame_request(Framing::Binary, 2, &body).is_ok());
    }

    #[test]
    fn header_sizes_are_range_checked_per_framing() {
        assert_eq!(resolve_header_size(Framing::None, None), Ok(0));
        assert_eq!(resolve_header_size(Framing::Ascii, Some(8)), Ok(8));
        assert!(resolve_header_size(Framing::Ascii, Some(9)).is_err());
        assert!(resolve_header_size(Framing::Ascii, None).is_err());
        assert_eq!(resolve_header_size(Framing::Binary, Some(4)), Ok(4));
        assert!(resolve_header_size(Framing::Binary, Some(5)).is_err());
        assert!(resolve_header_size(Framing::Binary, Some(0)).is_err());
    }

    #[test]
    fn hex_parsing_skips_whitespace_and_pins_its_errors() {
        assert_eq!(decode_hex("0a 1B\nff").expect("valid hex"), vec![0x0A, 0x1B, 0xFF]);
        assert_eq!(decode_hex("").expect("valid hex"), Vec::<u8>::new());
        assert_eq!(decode_hex("0G").unwrap_err(), "Invalid hex character.");
        assert_eq!(decode_hex("012").unwrap_err(), "Odd number of hex digits.");
    }

    #[test]
    fn framing_names_are_case_insensitive_and_closed() {
        assert!(Framing::parse("ASCII").is_ok());
        assert!(Framing::parse(" binary ").is_ok());
        assert_eq!(
            Framing::parse("length-prefixed").unwrap_err(),
            "TCP framing must be none, ascii, or binary."
        );
    }
}
