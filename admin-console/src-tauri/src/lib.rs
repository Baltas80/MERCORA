use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use tauri::State;

struct AdminSession(Mutex<Option<String>>);
const MAX_RESPONSE_BYTES: usize = 512 * 1024;
const CONTROL_HOST: &str = "127.0.0.1";
const CONTROL_PORT: &str = "8787";

fn allowed_endpoint(method: &str, path: &str) -> bool {
    matches!(
        (method, path),
        ("GET", "/api/admin/status") | ("POST", "/api/admin/action")
    )
}

fn action_payload(method: &str, path: &str, body: &str) -> Result<String, String> {
    if method == "GET" && path == "/api/admin/status" {
        return Ok(json!({ "action": "STATUS" }).to_string());
    }

    let input: Value =
        serde_json::from_str(body).map_err(|_| "Invalid administrative request JSON".to_string())?;
    let action = input
        .get("action")
        .and_then(Value::as_str)
        .map(|value| value.to_uppercase())
        .ok_or_else(|| "Administrative action is required".to_string())?;
    if !matches!(
        action.as_str(),
        "START" | "STOP" | "RESTART" | "STATUS" | "HEALTH_CHECK" | "RECOVER"
    ) {
        return Err("Unsupported administrative action".into());
    }

    let service = input.get("service").and_then(Value::as_str);
    if let Some(service) = service {
        if !matches!(service, "app" | "postgres" | "tor") {
            return Err("Unsupported administrative service".into());
        }
        return Ok(json!({ "action": action, "service": service }).to_string());
    }
    Ok(json!({ "action": action }).to_string())
}

fn decode_chunked_body(body: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoded = Vec::with_capacity(body.len());
    let mut cursor = 0usize;

    loop {
        let line_end = body[cursor..]
            .windows(2)
            .position(|window| window == b"\r\n")
            .ok_or_else(|| "Malformed chunked Admin API response".to_string())?;
        let line_end = cursor + line_end;
        let size_line = std::str::from_utf8(&body[cursor..line_end])
            .map_err(|_| "Invalid chunk size in Admin API response".to_string())?;
        let size_text = size_line.split(';').next().unwrap_or("").trim();
        let chunk_size = usize::from_str_radix(size_text, 16)
            .map_err(|_| "Invalid chunk size in Admin API response".to_string())?;
        cursor = line_end + 2;

        if chunk_size == 0 {
            if body.len() >= cursor + 2 && &body[cursor..cursor + 2] == b"\r\n" {
                cursor += 2;
            }
            return Ok(decoded);
        }

        if chunk_size > MAX_RESPONSE_BYTES.saturating_sub(decoded.len()) {
            return Err("Admin API response is too large".into());
        }
        if body.len() < cursor + chunk_size + 2 {
            return Err("Truncated chunked Admin API response".into());
        }

        decoded.extend_from_slice(&body[cursor..cursor + chunk_size]);
        cursor += chunk_size;
        if &body[cursor..cursor + 2] != b"\r\n" {
            return Err("Malformed chunked Admin API response".into());
        }
        cursor += 2;
    }
}

fn normalize_http_response(response: String) -> Result<String, String> {
    let header_end = response
        .find("\r\n\r\n")
        .ok_or_else(|| "Malformed Admin API response".to_string())?;
    let body_start = header_end + 4;
    let headers = &response[..header_end];
    let body = response.as_bytes()[body_start..].to_vec();

    let chunked = headers.lines().any(|line| {
        line.split_once(':')
            .map(|(name, value)| {
                name.eq_ignore_ascii_case("transfer-encoding")
                    && value
                        .split(',')
                        .any(|encoding| encoding.trim().eq_ignore_ascii_case("chunked"))
            })
            .unwrap_or(false)
    });

    if !chunked {
        return Ok(response);
    }

    let decoded = decode_chunked_body(&body)?;
    let mut normalized = String::with_capacity(headers.len() + 4 + decoded.len());
    normalized.push_str(headers);
    normalized.push_str("\r\n\r\n");
    normalized.push_str(
        std::str::from_utf8(&decoded)
            .map_err(|_| "Admin API response body is not valid UTF-8".to_string())?,
    );
    Ok(normalized)
}

fn raw_http_request(
    method: &str,
    path: &str,
    cookie: Option<&str>,
    payload: &str,
) -> Result<String, String> {
    let address = format!("{CONTROL_HOST}:{CONTROL_PORT}");
    let mut stream = TcpStream::connect_timeout(
        &address
            .parse()
            .map_err(|_| "Invalid control endpoint")?,
        std::time::Duration::from_secs(3),
    )
    .map_err(|e| format!("Admin Control API unavailable: {e}"))?;
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .map_err(|e| format!("Unable to configure read timeout: {e}"))?;
    stream
        .set_write_timeout(Some(std::time::Duration::from_secs(5)))
        .map_err(|e| format!("Unable to configure write timeout: {e}"))?;

    let cookie_header = cookie
        .filter(|value| !value.is_empty())
        .map(|value| format!("Cookie: {value}\r\n"))
        .unwrap_or_default();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {CONTROL_HOST}\r\n{cookie_header}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.as_bytes().len()
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("Request failed: {e}"))?;

    let mut response = Vec::with_capacity(4096);
    let mut chunk = [0_u8; 8192];
    loop {
        let read = stream
            .read(&mut chunk)
            .map_err(|e| format!("Response failed: {e}"))?;
        if read == 0 {
            break;
        }
        if response.len() + read > MAX_RESPONSE_BYTES * 2 {
            return Err("Admin API response is too large".into());
        }
        response.extend_from_slice(&chunk[..read]);
    }

    let response = String::from_utf8(response)
        .map_err(|_| "Admin API response is not valid UTF-8".to_string())?;
    normalize_http_response(response)
}

fn response_status_line(response: &str) -> &str {
    response.lines().next().unwrap_or("")
}

fn response_status_code(response: &str) -> Option<u16> {
    response_status_line(response)
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
}

fn response_body(response: &str) -> Result<&str, String> {
    let start = response
        .find("\r\n\r\n")
        .ok_or_else(|| "Malformed Admin API response".to_string())?
        + 4;
    Ok(&response[start..])
}

fn response_cookie_header(response: &str) -> Option<String> {
    let header_block = response.split("\r\n\r\n").next().unwrap_or_default();
    let cookies = header_block
        .lines()
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            if !name.eq_ignore_ascii_case("set-cookie") {
                return None;
            }
            let pair = value.split(';').next()?.trim();
            if pair.is_empty() || !pair.contains('=') {
                return None;
            }
            Some(pair.to_string())
        })
        .collect::<Vec<_>>();

    (!cookies.is_empty()).then(|| cookies.join("; "))
}

fn detailed_api_error(prefix: &str, response: &str) -> String {
    let status = response_status_line(response);
    let body = response_body(response)
        .unwrap_or("")
        .trim()
        .to_string();

    if body.is_empty() {
        format!("{prefix}: {status}")
    } else {
        format!("{prefix}: {status} - {body}")
    }
}

#[tauri::command]
fn admin_login(
    state: State<'_, AdminSession>,
    username: String,
    password: String,
) -> Result<String, String> {
    if username.trim().is_empty() || password.is_empty() || password.len() > 256 {
        return Err("Invalid credentials".into());
    }

    let payload = serde_json::to_string(&json!({
        "username": username,
        "password": password
    }))
    .map_err(|_| "Unable to prepare login request".to_string())?;

    let response = raw_http_request("POST", "/v1/login", None, &payload)?;
    if response_status_code(&response) != Some(200) {
        return Err(detailed_api_error("Admin login failed", &response));
    }

    let body = response_body(&response)?.to_string();
    let parsed: Value = serde_json::from_str(&body)
        .map_err(|_| "Admin API returned invalid login JSON".to_string())?;

    if parsed.get("ok") != Some(&Value::Bool(true))
        || parsed.pointer("/user/role").and_then(Value::as_str) != Some("admin")
    {
        return Err("Admin API did not confirm an administrator session".into());
    }

    let cookie = response_cookie_header(&response)
        .ok_or_else(|| "Admin login succeeded but no session cookie was returned".to_string())?;

    let session_response = raw_http_request("GET", "/v1/session", Some(&cookie), "{}")?;
    if response_status_code(&session_response) != Some(200) {
        let _ = raw_http_request("POST", "/v1/logout", Some(&cookie), "{}");
        return Err(detailed_api_error(
            "Admin session verification failed",
            &session_response,
        ));
    }

    *state
        .0
        .lock()
        .map_err(|_| "Session state unavailable")? = Some(cookie);

    Ok(body)
}

#[tauri::command]
fn admin_logout(state: State<'_, AdminSession>) -> Result<(), String> {
    let cookie = state
        .0
        .lock()
        .map_err(|_| "Session state unavailable")?
        .clone();

    if let Some(cookie) = cookie {
        let _ = raw_http_request("POST", "/v1/logout", Some(&cookie), "{}");
    }

    *state
        .0
        .lock()
        .map_err(|_| "Session state unavailable")? = None;
    Ok(())
}

#[tauri::command]
fn admin_request(
    state: State<'_, AdminSession>,
    method: String,
    path: String,
    body: Option<String>,
) -> Result<String, String> {
    if !allowed_endpoint(&method, &path) {
        return Err("Administrative endpoint is not allow-listed".into());
    }

    let payload = action_payload(&method, &path, body.as_deref().unwrap_or("{}"))?;
    let cookie = state
        .0
        .lock()
        .map_err(|_| "Session state unavailable")?
        .clone()
        .ok_or_else(|| "Not authenticated".to_string())?;

    let response = raw_http_request("POST", "/v1/control", Some(&cookie), &payload)?;
    let status = response_status_code(&response);
    if status != Some(200) && status != Some(503) {
        return Err(detailed_api_error("Admin API request failed", &response));
    }

    let response_body = response_body(&response)?;
    let _: Value = serde_json::from_str(response_body)
        .map_err(|_| "Invalid Admin API JSON".to_string())?;
    Ok(response_body.to_string())
}

#[cfg(test)]
mod tests {
    use super::decode_chunked_body;

    #[test]
    fn decodes_chunked_json_response_body() {
        let encoded = b"7\r\n{\"ok\":\r\n5\ntrue}\r\n0\r\n\r\n";
        let decoded = decode_chunked_body(encoded).expect("chunked response should decode");
        assert_eq!(decoded, b"{\"ok\":true}");
    }

    #[test]
    fn accepts_chunk_extensions() {
        let encoded = b"5;foo=bar\r\nhello\r\n0\r\n\r\n";
        let decoded = decode_chunked_body(encoded).expect("chunk extension should be accepted");
        assert_eq!(decoded, b"hello");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AdminSession(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            admin_login,
            admin_logout,
            admin_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running MERCORA Admin Console");
}
