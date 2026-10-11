//! Shared startup gate. No policy state, identity, or user content is stored or sent.
mod process;

use std::io::Read;
use std::path::Path;
use std::time::Duration;

pub const PRODUCT: &str = "BufferX";
pub const TEST_FIXTURES_ENABLED: bool = cfg!(feature = "test-fixtures");
pub const PRIMARY: &str = "https://amirsrad.ir/bufferx/startup-policy.json";
pub const SECONDARY: &str = "https://amirsradlicense.ir/bufferx/startup-policy.json";
pub const HELPER_NAME: &str = if cfg!(windows) {
    "BufferX.PolicyCheck.exe"
} else {
    "BufferX.PolicyCheck"
};
const HTTP_BUDGET: Duration = Duration::from_secs(2);
const HELPER_BUDGET: Duration = Duration::from_secs(3);
const MAX_BODY: usize = 16 * 1024;

fn version(text: &str) -> Option<[u64; 3]> {
    let parts: Vec<_> = text.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let mut result = [0; 3];
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        result[index] = part.parse().ok()?;
    }
    Some(result)
}

fn blocks(body: &[u8], current: &str) -> bool {
    let Some(current) = version(current) else {
        return false;
    };
    let Ok(policy) = serde_json::from_slice::<serde_json::Value>(body) else {
        return false;
    };
    if policy.get("schemaVersion").and_then(|value| value.as_u64()) != Some(1)
        || policy.get("product").and_then(|value| value.as_str()) != Some(PRODUCT)
    {
        return false;
    }
    let Some(required) = policy
        .get("updateRequired")
        .and_then(|value| value.as_bool())
    else {
        return false;
    };
    let minimum = match policy.get("minimumSupportedVersion") {
        None => None,
        Some(value) => match value.as_str().and_then(version) {
            Some(value) => Some(value),
            None => return false,
        },
    };
    required || minimum.is_some_and(|minimum| current < minimum)
}

fn check_url(endpoint: &str, current: &str) -> bool {
    if version(current).is_none() {
        return false;
    }
    let request = || -> Result<bool, Box<dyn std::error::Error>> {
        let builder = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(HTTP_BUDGET)
            .connect_timeout(HTTP_BUDGET)
            .user_agent(format!("{PRODUCT}/{current}"));
        // Isolated loopback fixtures must not traverse a machine's proxy/PAC.
        // This branch cannot be included in either production executable.
        #[cfg(any(test, feature = "test-fixtures"))]
        let builder = builder.no_proxy();
        let client = builder.build()?;
        let response = client
            .get(endpoint)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::CACHE_CONTROL, "no-cache, no-store")
            .send()?;
        if !response.status().is_success()
            || response
                .content_length()
                .is_some_and(|size| size > MAX_BODY as u64)
        {
            return Ok(false);
        }
        let mut body = Vec::new();
        response.take(MAX_BODY as u64 + 1).read_to_end(&mut body)?;
        Ok(body.len() <= MAX_BODY && blocks(&body, current))
    };
    request().unwrap_or(false)
}

/// Called before the desktop builder creates its engine or any webview.
pub fn update_required(current: &str, helper: &Path) -> bool {
    evaluate(PRIMARY, current, || {
        process::helper_blocks(helper, current, HELPER_BUDGET)
    })
}

fn evaluate(primary: &str, current: &str, secondary: impl FnOnce() -> bool) -> bool {
    check_url(primary, current) || secondary()
}

/// The production checker accepts only the release version; its endpoint is fixed.
pub fn checker_exit(current: &str) -> i32 {
    if check_url(SECONDARY, current) {
        10
    } else {
        0
    }
}

// The fixture interface is absent from all production outputs. The production binary
// also rejects builds with this feature, even if accidentally enabled by a caller.
#[cfg(feature = "test-fixtures")]
pub fn fixture_exit(endpoint: &str, current: &str) -> i32 {
    let Ok(url) = reqwest::Url::parse(endpoint) else {
        return 0;
    };
    if url.scheme() != "http" || !matches!(url.host_str(), Some("127.0.0.1" | "[::1]")) {
        return 0;
    }
    if check_url(endpoint, current) {
        10
    } else {
        0
    }
}

#[cfg(test)]
mod tests;
