use serde_json::Value;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use tauri::State;

struct AdminToken(Mutex<Option<String>>);

#[tauri::command]
fn set_token(state: State<'_, AdminToken>, token: String) -> Result<(), String> {
    if token.trim().is_empty() || token.len() > 512 {
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
fn admin_request(state: State<'_, AdminToken>, method: String, path: String, body: Option<String>) -> Result<String, String> {
    if !path.starts_with("/api/admin/") || path.contains("..") || path.contains('\\') {
        return Err("Invalid administrative path".into());
    }
    if method != "GET" && method != "POST" {
        return Err("Unsupported method".into());
    }

    let token = state.0.lock().map_err(|_| "Token state unavailable")?.clone()
        .ok_or_else(|| "Not authenticated".to_string())?;

    let mut stream = TcpStream::connect_timeout(
        &"127.0.0.1:8090".parse().map_err(|_| "Invalid control endpoint")?,
        std::time::Duration::from_secs(3),
    ).map_err(|e| format!("Admin Control API unavailable: {e}"))?;
    stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).ok();
    stream.set_write_timeout(Some(std::time::Duration::from_secs(5))).ok();

    let payload = body.unwrap_or_default();
    let request = if method == "POST" {
        format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
            payload.as_bytes().len()
        )
    } else {
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n")
    };

    stream.write_all(request.as_bytes()).map_err(|e| format!("Request failed: {e}"))?;
    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(|e| format!("Response failed: {e}"))?;

    let body_start = response.find("\r\n\r\n").ok_or_else(|| "Malformed Admin API response".to_string())? + 4;
    let status_line = response.lines().next().unwrap_or("");
    if !status_line.contains(" 200 ") {
        return Err(format!("Admin API error: {}", status_line));
    }
    let response_body = &response[body_start..];
    let _: Value = serde_json::from_str(response_body).map_err(|_| "Invalid Admin API JSON".to_string())?;
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
