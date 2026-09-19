#ifndef BUFFERX_ABI_H
#define BUFFERX_ABI_H

/*
 * The BufferX C ABI -- one JSON-in / JSON-out entry point over the C++ domain
 * core.
 *
 * Everything the engine can do is reached through `bufferx_invoke`. There is no
 * second surface: the Rust desktop host and the WebAssembly build call the same
 * function with the same bytes and get the same bytes back, so a behaviour that
 * differs between desktop and browser is a bug rather than a design choice.
 *
 *
 * ENVELOPE
 * --------
 * Request, in every case:
 *
 *     { "v": 1, "op": "<name>", "args": { ... } }
 *
 * Success:
 *
 *     { "ok": true, "data": { ... } }
 *
 * Failure:
 *
 *     { "ok": false,
 *       "error": { "code": "<CODE>", "message": "<human text>",
 *                  "detail": { ... optional ... } } }
 *
 * `data` is always a JSON object -- never a bare scalar, never null. Ops with
 * nothing to say answer `{"ok":true,"data":{}}`.
 *
 * `error.code` is one of thirteen stable, never-localized values:
 *
 *     BAD_HEX            a hex-text argument would not parse
 *     BAD_LENGTH         a byte or digit length rule was violated
 *     BAD_ARGUMENT       an argument is missing, mistyped, or out of range;
 *                        also the malformed-envelope case
 *     UNKNOWN_PACKAGER   the named packager is not in this session's registry
 *     UNKNOWN_OP         `op` is not an operation this engine serves
 *     DECODE_FAILED      ISO 8583 decode failed
 *     ENCODE_FAILED      ISO 8583 encode failed
 *     CRYPTO_FAILED      a symmetric, PIN, MAC, or RSA operation failed
 *     PARSE_FAILED       a TLV or XML document would not parse
 *     UNSUPPORTED        the request names a protocol version or a capability
 *                        this build does not serve
 *     HOST_ONLY          the op needs the native host; the C ABI is pure
 *                        computation and never serves it
 *     TIMEOUT            a time budget was exceeded
 *     INTERNAL           unclassified fault, allocation failure, or an
 *                        unexpected exception
 *
 * `error.message` is one English sentence describing what was structurally
 * wrong. It never contains a PIN, a PIN block, a key, or PEM material -- see
 * SECRECY below.
 *
 *
 * MEMORY
 * ------
 * `bufferx_invoke` returns a heap-allocated, NUL-terminated UTF-8 string that
 * the caller owns and must release with `bufferx_string_free`. Releasing it
 * with `free`, `delete`, or a foreign allocator is undefined; the ABI may not
 * share an allocator with the caller.
 *
 * `bufferx_invoke` NEVER returns NULL. A failure anywhere -- bad JSON, an
 * unknown op, a thrown exception, an allocation failure inside a handler --
 * still produces a valid error envelope. Only if allocating that envelope also
 * fails does it fall back to a process-static string, which
 * `bufferx_string_free` recognizes and does not attempt to free. Callers
 * therefore never need a NULL branch.
 *
 * `bufferx_version` returns a pointer to static storage. Do not free it.
 *
 *
 * EXCEPTIONS
 * ----------
 * No exception crosses this boundary. Every handler runs inside a try/catch
 * that converts anything unrecognized into an `INTERNAL` error envelope. A C or
 * Rust caller can treat these functions as `noexcept`.
 *
 *
 * SESSIONS AND STATE
 * ------------------
 * Engine state -- currently the loaded packager registry -- lives in the
 * session, not in globals. This is deliberate: a global registry would mean
 * that loading a packager XML in one window, or one browser tab, silently
 * changed how the other one decodes messages. Two sessions are fully
 * independent.
 *
 * A NULL session is accepted and served by a single process-wide default
 * session, so that simple embedders and the WebAssembly glue can pass NULL
 * without ceremony. Everything that passes NULL shares that one registry, which
 * is the right behaviour for a one-engine-per-tab deployment and the wrong
 * behaviour for a multi-tenant host -- such a host should open a session per
 * tenant.
 *
 * THREADING: one session is NOT thread-safe. Concurrent calls on the same
 * `bufferx_session*` (including concurrent calls that both pass NULL, which
 * share the default session) must be serialized by the caller. Distinct
 * sessions may be used concurrently from different threads without
 * synchronization. `bufferx_open` and `bufferx_close` are safe to call from any
 * thread as long as no other call is in flight on the session being closed.
 * `bufferx_version` is safe from any thread.
 *
 *
 * SECRECY
 * -------
 * PINs, PIN blocks, symmetric keys, PVKs, and PEM private keys are sensitive.
 * This layer never logs, caches, or persists them, and never places them in an
 * error message or an error detail. Errors describe the shape of the problem
 * ("key must be 16, 32, or 48 hex characters") and never the value.
 */

#include <stddef.h>

/*
 * Visibility. The shared build exports exactly the five functions below and
 * nothing else: the C++ core behind them is an implementation detail, and a
 * DLL that also exported std::string's instantiations would collide with a
 * host that has its own.
 *
 *   BUFFERX_ABI_BUILD_SHARED    defined while compiling the shared library
 *   BUFFERX_ABI_IMPORT_SHARED   defined by a Windows consumer that links it
 *
 * Neither is needed for the static library or for a Rust host that declares
 * the symbols itself.
 */
#if defined(_WIN32)
#  if defined(BUFFERX_ABI_BUILD_SHARED)
#    define BUFFERX_ABI_API __declspec(dllexport)
#  elif defined(BUFFERX_ABI_IMPORT_SHARED)
#    define BUFFERX_ABI_API __declspec(dllimport)
#  else
#    define BUFFERX_ABI_API
#  endif
#elif defined(BUFFERX_ABI_BUILD_SHARED) && (defined(__GNUC__) || defined(__clang__))
#  define BUFFERX_ABI_API __attribute__((visibility("default")))
#else
#  define BUFFERX_ABI_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* Semantic version of the engine build, as returned by bufferx_version(). */
#define BUFFERX_ABI_VERSION "2.0.0"

/* Envelope contract major version -- the `v` this engine accepts. */
#define BUFFERX_ABI_PROTOCOL 1

/*
 * An engine session. Opaque by design: its layout is an implementation detail
 * and may change without a contract version bump.
 */
typedef struct bufferx_session bufferx_session;

/*
 * Creates a session with an empty packager registry.
 * Returns NULL only if the allocation fails; callers may then pass NULL to
 * bufferx_invoke and be served by the process-wide default session.
 */
BUFFERX_ABI_API bufferx_session* bufferx_open(void);

/*
 * Destroys a session created by bufferx_open. Passing NULL is a no-op, and in
 * particular does NOT destroy the process-wide default session. Using a session
 * pointer after closing it is undefined.
 */
BUFFERX_ABI_API void bufferx_close(bufferx_session* session);

/*
 * Executes one request. `session` may be NULL (see SESSIONS AND STATE).
 * `request_json` is a NUL-terminated UTF-8 JSON object; a NULL pointer yields a
 * BAD_ARGUMENT envelope rather than a crash.
 *
 * Returns a NUL-terminated UTF-8 JSON envelope, never NULL. Release it with
 * bufferx_string_free.
 */
BUFFERX_ABI_API char* bufferx_invoke(bufferx_session* session, const char* request_json);

/*
 * Releases a string returned by bufferx_invoke. Passing NULL is a no-op.
 * Passing a pointer this ABI did not produce is undefined.
 */
BUFFERX_ABI_API void bufferx_string_free(char* text);

/*
 * The engine build version, e.g. "2.0.0". Static storage; never freed.
 */
BUFFERX_ABI_API const char* bufferx_version(void);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* BUFFERX_ABI_H */
