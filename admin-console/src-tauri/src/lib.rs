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
    matches!((method, path), ("GET", "/api/admin/status") | ("POST", "/api/admin/action"))
}

fn action_payload(method: &str, path: &str, body: &str) -> Result<String, String> {
    if method == "GET" && path == "/api/admin/status" {
        return Ok(json!({ "action": "STATUS" }).to_string());
    }

    let input: Value = serde_json::from_str(body).map_err(|_| "Invalid administrative request JSON".to_string())?;
    let action = input.get("action")
        .and_then(Value::as_str)
        .map(|value| value.to_uppercase())
        .ok_or_else(|| "Administrative action is required".to_string())?;
    if !matches!(action.as_str(), "START" | "STOP" | "RESTART" | "STATUS" | "HEALTH_CHECK" | "RECOVER") {
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

fn raw_http_request(method: &str, path: &str, cookie: Option<&str>, payload: &str) -> Result<String, String> {
    let address = format!("{CONTROL_HOST}:{CONTROL_PORT}");
    let mut stream = TcpStream::connect_timeout(
        &address.parse().map_err(|_| "Invalid control endpoint")?,
        std::time::Duration::from_secs(3)
    ).map_err(|e| format!("Admin Control API unavailable: {e}"))?;
    stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).map_err(|e| format!("Unable to configure read timeout: {e}"))?;
    stream.set_write_timeout(Some(std::time::Duration::from_secs(5))).map_err(|e| format!("Unable to configure write timeout: {e}"))?;

    let cookie_header = cookie.map(|value| format!("Cookie: {value}\r\n")).unwrap_or_default();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {CONTROL_HOST}\r\n{cookie_header}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.as_bytes().len()
    );
    stream.write_all(request.as_bytes()).map_err(|e| format!("Request failed: {e}"))?;

    let mut response = Vec::with_capacity(4096);
    let mut chunk = [0_u8; 8192];
    loop {
        let read = stream.read(&mut chunk).map_err(|e| format!("Response failed: {e}"))?;
        if read == 0 { break; }
        if response.len() + read > MAX_RESPONSE_BYTES { return Err("Admin API response is too large".into()); }
        response.extend_from_slice(&chunk[..read]);
    }
    String::from_utf8(response).map_err(|_| "Admin API response is not valid UTF-8".to_string())
}

fn response_status(response: &str) -> &str {
    response.lines().next().unwrap_or("")
}

fn response_body(response: &str) -> Result<&str, String> {
    let start = response.find("\r\n\r\n").ok_or_else(|| "Malformed Admin API response".to_string())? + 4;
    Ok(&response[start..])
}

fn response_cookie(response: &str) -> Option<String> {
    response.lines()
        .find(|line| line.to_ascii_lowercase().starts_with("set-cookie:"))
        .and_then(|line| line.split_once(':').map(|(_, value)| value.trim()))
        .and_then(|value| value.split(';').next())
        .map(str::to_string)
}

#[tauri::command]
fn admin_login(state: State<'_, AdminSession>, username: String, password: String) -> Result<String, String> {
    if username.trim().is_empty() || password.is_empty() || password.len() > 256 {
        return Err("Invalid credentials".into());
    }
    let payload = serde_json::to_string(&json!({ "username": username, "password": password }))
        .map_err(|_| "Unable to prepare login request".to_string())?;
    let response = raw_http_request("POST", "/v1/login", None, &payload)?;
    if !response_status(&response).starts_with("HTTP/1.1 200 ") {
        return Err("Invalid username or password".into());
    }
    let cookie = response_cookie(&response).ok_or_else(|| "Authentication session was not established".to_string())?;
    *state.0.lock().map_err(|_| "Session state unavailable")? = Some(cookie);
    Ok(response_body(&response)?.to_string())
}

#[tauri::command]
fn admin_logout(state: State<'_, AdminSession>) -> Result<(), String> {
    let cookie = state.0.lock().map_err(|_| "Session state unavailable")?.clone();
    if let Some(cookie) = cookie {
        let _ = raw_http_request("POST", "/v1/logout", Some(&cookie), "{}");
    }
    *state.0.lock().map_err(|_| "Session state unavailable")? = None;
    Ok(())
}

#[tauri::command]
fn admin_request(state: State<'_, AdminSession>, method: String, path: String, body: Option<String>) -> Result<String, String> {
    if !allowed_endpoint(&method, &path) { return Err("Administrative endpoint is not allow-listed".into()); }
    let payload = action_payload(&method, &path, body.as_deref().unwrap_or("{}"))?;
    let cookie = state.0.lock().map_err(|_| "Session state unavailable")?.clone().ok_or_else(|| "Not authenticated".to_string())?;

    let response = raw_http_request("POST", "/v1/control", Some(&cookie), &payload)?;
    let status_line = response_status(&response);
    if !status_line.starts_with("HTTP/1.1 200 ") && !status_line.starts_with("HTTP/1.1 503 ") {
        return Err(format!("Admin API error: {status_line}"));
    }
    let response_body = response_body(&response)?;
    let _: Value = serde_json::from_str(response_body).map_err(|_| "Invalid Admin API JSON".to_string())?;
    Ok(response_body.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AdminSession(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![admin_login, admin_logout, admin_request])
        .run(tauri::generate_context!())
        .expect("error while running MERCORA Admin Console");
}
