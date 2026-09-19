//! FFI bridge to the BufferX C ABI.
//!
//! The engine exposes exactly one entry point — a versioned JSON request in,
//! a versioned JSON response out — so this module stays a transport and never
//! becomes a second implementation of the contract. It does not inspect
//! requests, does not reshape responses, and knows about exactly one op name
//! (see [`CAPABILITIES_OP`]).
//!
//! Two rules govern everything here:
//!
//! * **Requests are secret.** They carry PINs, PIN blocks, PVKs, symmetric keys
//!   and PEM private keys. Nothing in this file logs a request, embeds one in an
//!   error message, or keeps one alive past the call.
//! * **The C string the ABI returns is ours to free.** Every path out of an
//!   invocation, including the error paths, goes through [`EngineString`], whose
//!   `Drop` calls `bufferx_string_free`.

use std::ffi::{CStr, CString};
use std::fmt;
use std::os::raw::c_char;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::State;

/// The one op this shell answers itself instead of forwarding.
///
/// The C core computes ISO 8583 and cryptography; it has no way to know whether
/// it is running inside a browser tab or a desktop window, and therefore cannot
/// say whether raw sockets and the filesystem are reachable. Only the host
/// knows, so only the host answers.
const CAPABILITIES_OP: &str = "engine.capabilities";

/// Verbatim from the engine contract: what a `NULL` return means.
const NO_RESPONSE: &str = "Engine returned no response.";

/// Opaque handle type mirroring `bufferx_session` in `core/abi/bufferx_abi.h`.
///
/// Never constructed on this side; it exists so the pointer has a distinct type
/// rather than being a bare `*mut c_void`.
#[repr(C)]
pub struct BufferxSession {
    _private: [u8; 0],
}

extern "C" {
    fn bufferx_open() -> *mut BufferxSession;
    fn bufferx_close(session: *mut BufferxSession);
    fn bufferx_invoke(session: *mut BufferxSession, request_json: *const c_char) -> *mut c_char;
    fn bufferx_string_free(text: *mut c_char);
    fn bufferx_version() -> *const c_char;
}

// ---------------------------------------------------------------------------
// Session ownership
// ---------------------------------------------------------------------------

/// Owns one `bufferx_session*` and closes it exactly once.
struct Session {
    handle: *mut BufferxSession,
}

// SAFETY: the handle is only ever reached through `Engine`, which keeps it
// behind a `Mutex`, so no two threads are inside the C core for this session at
// the same time. The core requires non-overlapping calls, not calls from one
// specific thread, which is what makes moving the handle between threads sound.
unsafe impl Send for Session {}

impl Drop for Session {
    fn drop(&mut self) {
        // SAFETY: `handle` was returned non-null by `bufferx_open`, has not been
        // closed before (nothing else can reach it), and is not used after this.
        unsafe { bufferx_close(self.handle) };
    }
}

/// Failure to open an engine session. Fatal at startup: with no session there
/// is nothing for the UI to talk to.
#[derive(Debug)]
pub struct EngineInitError;

impl fmt::Display for EngineInitError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("The BufferX engine could not open a session (bufferx_open returned null).")
    }
}

impl std::error::Error for EngineInitError {}

/// Managed state: one engine session shared by every window and every command.
///
/// A session is not thread-safe, so it lives behind a `Mutex`. The `Arc` exists
/// so an invocation can move a handle onto the blocking pool without borrowing
/// from the `State` it came from.
pub struct Engine {
    session: Arc<Mutex<Session>>,
}

impl Engine {
    /// Opens the single process-wide session.
    pub fn new() -> Result<Self, EngineInitError> {
        // SAFETY: no arguments and no aliasing. The ABI documents a null return
        // for allocation failure, which is checked below.
        let handle = unsafe { bufferx_open() };
        if handle.is_null() {
            return Err(EngineInitError);
        }
        Ok(Self {
            session: Arc::new(Mutex::new(Session { handle })),
        })
    }
}

// ---------------------------------------------------------------------------
// Owned response strings
// ---------------------------------------------------------------------------

/// A string allocated by the C core, freed through the core's own allocator.
///
/// This type is the reason a mid-invocation error cannot leak: whether the
/// response is decoded successfully, turns out not to be UTF-8, or the function
/// returns early for any other reason, `Drop` still runs.
struct EngineString {
    ptr: *mut c_char,
}

impl EngineString {
    /// # Safety
    ///
    /// `ptr` must be non-null, must have come from `bufferx_invoke`, and must
    /// not have been freed or wrapped by another `EngineString`.
    unsafe fn from_raw(ptr: *mut c_char) -> Self {
        Self { ptr }
    }

    fn to_str(&self) -> Result<&str, std::str::Utf8Error> {
        // SAFETY: non-null and NUL-terminated by construction, and the pointee
        // outlives the borrow because `self` owns it until `Drop`.
        unsafe { CStr::from_ptr(self.ptr) }.to_str()
    }
}

impl Drop for EngineString {
    fn drop(&mut self) {
        // SAFETY: the pointer came from the ABI and this is its only free.
        unsafe { bufferx_string_free(self.ptr) };
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Forwards one envelope to the engine and returns its answer verbatim.
///
/// A failed *operation* is not a failed command: the engine reports it inside
/// the envelope as `{"ok":false,...}` and this returns `Ok`. The `Err` arm is
/// reserved for the transport itself breaking.
#[tauri::command]
pub async fn engine_invoke(request: Value, engine: State<'_, Engine>) -> Result<Value, String> {
    if request.get("op").and_then(Value::as_str) == Some(CAPABILITIES_OP) {
        return Ok(capabilities_envelope());
    }

    // Serialized, moved, used, dropped. Never logged — this string is where the
    // PINs and keys are.
    let request_json = serde_json::to_string(&request)
        .map_err(|_| "The request could not be serialized for the engine.".to_string())?;

    let session = Arc::clone(&engine.session);

    // The C core is synchronous and can spend real time in a crypto routine, so
    // it runs on the blocking pool: never on the webview thread, and never
    // parked on an async worker.
    let response_json = tauri::async_runtime::spawn_blocking(move || invoke_session(&session, &request_json))
        .await
        .map_err(|_| "The engine call did not complete.".to_string())?;

    let response_json = response_json?;

    serde_json::from_str(&response_json)
        .map_err(|_| "The engine returned a malformed response.".to_string())
}

/// Reports the engine build version. Non-sensitive; used in the About panel and
/// in bug reports.
#[tauri::command]
pub fn engine_version() -> Result<String, String> {
    // SAFETY: the ABI returns a pointer to storage it owns for the life of the
    // process. It is read, never freed.
    let raw = unsafe { bufferx_version() };
    if raw.is_null() {
        return Err("The engine did not report a version.".to_string());
    }
    // SAFETY: non-null and NUL-terminated, borrowed only for this expression.
    unsafe { CStr::from_ptr(raw) }
        .to_str()
        .map(str::to_owned)
        .map_err(|_| "The engine reported a version that is not valid UTF-8.".to_string())
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/// The blocking half of [`engine_invoke`]: lock, call, copy, free.
fn invoke_session(session: &Mutex<Session>, request_json: &str) -> Result<String, String> {
    let request = CString::new(request_json)
        .map_err(|_| "The request contained an interior NUL byte.".to_string())?;

    // A poisoned lock means a previous call panicked inside the C core. The
    // session's internal state is then unknown, so it is not reused.
    let session = session
        .lock()
        .map_err(|_| "The engine session is no longer usable; restart BufferX.".to_string())?;

    // SAFETY: the lock gives exclusive access to the session for this call, and
    // `request` outlives it. The core copies whatever it needs from the input.
    let raw = unsafe { bufferx_invoke(session.handle, request.as_ptr()) };

    if raw.is_null() {
        // Contract: null means the engine could not even build a response.
        // The caller gets a well-formed failure envelope, not a panic.
        return Ok(internal_error_envelope(NO_RESPONSE));
    }

    // SAFETY: non-null, freshly returned by `bufferx_invoke`, and wrapped once.
    // From here every exit path frees it.
    let response = unsafe { EngineString::from_raw(raw) };

    response
        .to_str()
        .map(str::to_owned)
        .map_err(|_| "The engine returned a response that is not valid UTF-8.".to_string())
}

/// What this shell can do that a browser tab cannot.
///
/// Wrapped in the standard envelope so the frontend parses it with the same
/// code path as every other response.
fn capabilities_envelope() -> Value {
    json!({
        "ok": true,
        "data": {
            "tcp": true,
            "files": true,
            "keyFiles": true,
            "desktop": true
        }
    })
}

fn internal_error_envelope(message: &str) -> String {
    json!({
        "ok": false,
        "error": {
            "code": "INTERNAL",
            "message": message
        }
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_report_every_desktop_feature() {
        let envelope = capabilities_envelope();
        assert_eq!(envelope["ok"], json!(true));
        for feature in ["tcp", "files", "keyFiles", "desktop"] {
            assert_eq!(envelope["data"][feature], json!(true), "{feature}");
        }
    }

    /// Exercises the whole FFI path against the real linked ABI: open a
    /// session, send a request, decode the answer, free the C string, close.
    ///
    /// A deliberately unknown op is used so the test depends on the envelope
    /// contract rather than on any particular operation's arguments, and so it
    /// never has to put key material in a test fixture.
    #[test]
    fn a_real_session_round_trips_a_request() {
        let engine = Engine::new().expect("the linked ABI must open a session");

        let response = invoke_session(
            &engine.session,
            r#"{"v":1,"op":"bufferx.test.no.such.op","args":{}}"#,
        )
        .expect("the transport must not fail");

        let parsed: Value = serde_json::from_str(&response).expect("the ABI must return valid JSON");
        assert_eq!(parsed["ok"], json!(false));
        assert!(
            parsed["error"]["code"].is_string(),
            "every failure envelope carries a string code, got {parsed}"
        );
    }

    #[test]
    fn the_linked_engine_reports_a_version() {
        let version = engine_version().expect("the linked ABI must report a version");
        assert!(
            version.split('.').count() >= 2,
            "expected a semantic version, got {version:?}"
        );
    }

    #[test]
    fn null_response_becomes_an_internal_error_envelope() {
        let parsed: Value = serde_json::from_str(&internal_error_envelope(NO_RESPONSE))
            .expect("the synthesized envelope must be valid JSON");
        assert_eq!(parsed["ok"], json!(false));
        assert_eq!(parsed["error"]["code"], json!("INTERNAL"));
        assert_eq!(parsed["error"]["message"], json!(NO_RESPONSE));
    }
}
