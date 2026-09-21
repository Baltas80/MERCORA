use serde_json::Value;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use tauri::State;

struct AdminToken(Mutex<Option<String>>);

const MAX_RESPONSE_BYTES: usize = 512 * 1024;

fn valid_token(token: &str) -> bool {
    !token.trim().is_empty()
        && token.len() <= 512
        && !token.bytes().any(|b| b == b'\r' || b == b'\n')
}

fn allowed_endpoint(method: &str, path: &str) -> bool {
    matches!(
        (method, path),
        ("GET", "/api/admin/status")
            | ("POST", "/api/admin/action")
    )
}

#[tauri::command]
fn set_token(state: State<'_, AdminToken>, token: String) -> Result<(), String> {
    if !valid_token(&token) {
        return Err("Invalid admin token".into());
    }
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
    body: Option<String>,
) -> Result<String, String> {
    if !allowed_endpoint(&method, &path) {
        return Err("Administrative endpoint is not allow-listed".into());
    }

    let payload = body.unwrap_or_default();
    if payload.len() > 8 * 1024 {
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

    let mut stream = TcpStream::connect_timeout(
        &"127.0.0.1:8090"
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

    let request = if method == "POST" {
        format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
            payload.as_bytes().len()
        )
    } else {
        format!(
            "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
        )
    };

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
        if response.len() + read > MAX_RESPONSE_BYTES {
            return Err("Admin API response is too large".into());
        }
        response.extend_from_slice(&chunk[..read]);
    }

    let response = String::from_utf8(response)
        .map_err(|_| "Admin API response is not valid UTF-8".to_string())?;
    let body_start = response
        .find("\r\n\r\n")
        .ok_or_else(|| "Malformed Admin API response".to_string())?
        + 4;
    let status_line = response.lines().next().unwrap_or("");
    if !status_line.starts_with("HTTP/1.1 200 ") {
        return Err(format!("Admin API error: {status_line}"));
    }

    let response_body = &response[body_start..];
    let _: Value = serde_json::from_str(response_body)
        .map_err(|_| "Invalid Admin API JSON".to_string())?;
    Ok(response_body.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AdminToken(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![set_token, clear_token, admin_request])
        .run(tauri::generate_context!())
        .expect("error while running MERCORA Admin Console");
}
