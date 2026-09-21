use serde_json::Value;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use tauri::State;

struct AdminToken(Mutex<Option<String>>);
const CONTROL_HOST: &str = "127.0.0.1";
const CONTROL_PORT: &str = "8787";
const MAX_REQUEST_BYTES: usize = 32 * 1024;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

fn valid_token(token: &str) -> bool {
    !token.trim().is_empty()
        && token.len() <= 512
        && !token.bytes().any(|b| b == b'\r' || b == b'\n')
}

fn allowed_endpoint(method: &str, path: &str) -> bool {
    matches!(
        (method, path),
        ("GET", "/v1/overview")
            | ("POST", "/v1/control")
            | ("POST", "/v1/management")
            | ("POST", "/v1/reputation")
            | ("POST", "/v1/escrow")
            | ("POST", "/v1/system")
    )
}

#[tauri::command]
fn set_token(state: State<'_, AdminToken>, token: String) -> Result<(), String> {
    if !valid_token(&token) { return Err("Invalid admin token".into()); }
    *state.0.lock().map_err(|_| "Token state unavailable")? = Some(token);
    Ok(())
}

#[tauri::command]
fn clear_token(state: State<'_, AdminToken>) -> Result<(), String> {
    *state.0.lock().map_err(|_| "Token state unavailable")? = None;
    Ok(())
}

#[tauri::command]
fn admin_request(
    state: State<'_, AdminToken>,
    method: String,
    path: String,
    body: Option<String>
) -> Result<String, String> {
    if !allowed_endpoint(&method, &path) {
        return Err("Administrative endpoint is not allow-listed".into());
    }

    let payload = body.unwrap_or_default();
    if payload.len() > MAX_REQUEST_BYTES {
        return Err("Administrative request body is too large".into());
    }

    let token = state
        .0
        .lock()
        .map_err(|_| "Token state unavailable")?
        .clone()
        .ok_or_else(|| "Not authenticated".to_string())?;

    if !valid_token(&token) {
        return Err("Invalid stored admin token".into());
    }

    let address = format!("{}:{}", CONTROL_HOST, CONTROL_PORT);
    let mut stream = TcpStream::connect_timeout(
        &address.parse().map_err(|_| "Invalid control endpoint")?,
        std::time::Duration::from_secs(3)
    ).map_err(|e| format!("Admin Control API unavailable: {e}"))?;

    stream.set_read_timeout(Some(std::time::Duration::from_secs(8)))
        .map_err(|e| format!("Unable to configure read timeout: {e}"))?;
    stream.set_write_timeout(Some(std::time::Duration::from_secs(8)))
        .map_err(|e| format!("Unable to configure write timeout: {e}"))?;

    let request = if method == "POST" {
        format!(
            "POST {} HTTP/1.1\r\nHost: {}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            path, CONTROL_HOST, token, payload.as_bytes().len(), payload
        )
    } else {
        format!(
            "GET {} HTTP/1.1\r\nHost: {}\r\nAuthorization: Bearer {}\r\nConnection: close\r\n\r\n",
            path, CONTROL_HOST, token
        )
    };

    stream.write_all(request.as_bytes()).map_err(|e| format!("Request failed: {e}"))?;

    let mut response = Vec::with_capacity(4096);
    let mut chunk = [0_u8; 8192];
    loop {
        let read = stream.read(&mut chunk).map_err(|e| format!("Response failed: {e}"))?;
        if read == 0 { break; }
        if response.len() + read > MAX_RESPONSE_BYTES {
            return Err("Admin API response is too large".into());
        }
        response.extend_from_slice(&chunk[..read]);
    }

    let response = String::from_utf8(response)
        .map_err(|_| "Admin API response is not valid UTF-8".to_string())?;
    let body_start = response.find("\r\n\r\n")
        .ok_or_else(|| "Malformed Admin API response".to_string())? + 4;
    let status_line = response.lines().next().unwrap_or("");
    let response_body = &response[body_start..];

    let parsed: Value = serde_json::from_str(response_body)
        .map_err(|_| "Invalid Admin API JSON".to_string())?;

    if !status_line.starts_with("HTTP/1.1 2") {
        let message = parsed
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Admin API request failed");
        return Err(message.to_string());
    }

    Ok(parsed.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AdminToken(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![set_token, clear_token, admin_request])
        .run(tauri::generate_context!())
        .expect("error while running MERCORA Admin Console");
}
