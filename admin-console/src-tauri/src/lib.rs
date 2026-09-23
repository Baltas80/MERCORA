use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use tauri::State;

struct AdminToken(Mutex<Option<String>>);
const MAX_RESPONSE_BYTES: usize = 512 * 1024;
const CONTROL_HOST: &str = "127.0.0.1";
const CONTROL_PORT: &str = "8787";
#[cfg(windows)]
const KEYRING_SERVICE: &str = "MERCORA Admin Console";
#[cfg(windows)]
const KEYRING_ACCOUNT: &str = "admin-token";

fn valid_token(token: &str) -> bool {
    !token.trim().is_empty() && token.len() <= 512 && !token.bytes().any(|b| b == b'\r' || b == b'\n')
}

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

#[cfg(windows)]
fn credential_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("Windows Credential Manager unavailable: {e}"))
}

fn store_token(state: &State<'_, AdminToken>, token: String) -> Result<(), String> {
    if !valid_token(&token) { return Err("Invalid admin token".into()); }
    #[cfg(windows)]
    credential_entry()?.set_password(&token).map_err(|e| format!("Unable to store admin credential: {e}"))?;
    *state.0.lock().map_err(|_| "Token state unavailable")? = Some(token);
    Ok(())
}

#[tauri::command]
fn load_stored_token(state: State<'_, AdminToken>) -> Result<bool, String> {
    #[cfg(windows)]
    {
        match credential_entry()?.get_password() {
            Ok(token) => {
                if !valid_token(&token) { return Err("Stored admin credential is invalid".into()); }
                *state.0.lock().map_err(|_| "Token state unavailable")? = Some(token);
                Ok(true)
            }
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(error) => Err(format!("Unable to read admin credential: {error}"))
        }
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

#[tauri::command]
fn set_token(state: State<'_, AdminToken>, token: String) -> Result<(), String> {
    store_token(&state, token)
}

#[tauri::command]
fn bootstrap_token(state: State<'_, AdminToken>) -> Result<(), String> {
    let response = raw_http_request("POST", "/v1/bootstrap", None, "")?;
    let status_line = response.lines().next().unwrap_or("");
    if !status_line.starts_with("HTTP/1.1 200 ") {
        return Err("First-run bootstrap is unavailable. Enter the configured admin token.".into());
    }
    let body_start = response.find("\r\n\r\n").ok_or_else(|| "Malformed bootstrap response".to_string())? + 4;
    let body: Value = serde_json::from_str(&response[body_start..]).map_err(|_| "Invalid bootstrap response".to_string())?;
    let token = body.get("token").and_then(Value::as_str).ok_or_else(|| "Bootstrap response did not contain a credential".to_string())?;
    store_token(&state, token.to_string())
}

#[tauri::command]
fn clear_token(state: State<'_, AdminToken>) -> Result<(), String> {
    *state.0.lock().map_err(|_| "Token state unavailable")? = None;
    Ok(())
}

#[tauri::command]
fn forget_token(state: State<'_, AdminToken>) -> Result<(), String> {
    *state.0.lock().map_err(|_| "Token state unavailable")? = None;
    #[cfg(windows)]
    {
        match credential_entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(format!("Unable to remove admin credential: {error}"))
        }
    }
    Ok(())
}

fn raw_http_request(method: &str, path: &str, token: Option<&str>, payload: &str) -> Result<String, String> {
    let address = format!("{CONTROL_HOST}:{CONTROL_PORT}");
    let mut stream = TcpStream::connect_timeout(
        &address.parse().map_err(|_| "Invalid control endpoint")?,
        std::time::Duration::from_secs(3)
    ).map_err(|e| format!("Admin Control API unavailable: {e}"))?;
    stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).map_err(|e| format!("Unable to configure read timeout: {e}"))?;
    stream.set_write_timeout(Some(std::time::Duration::from_secs(5))).map_err(|e| format!("Unable to configure write timeout: {e}"))?;

    let authorization = token.map(|value| format!("Authorization: Bearer {value}\r\n")).unwrap_or_default();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {CONTROL_HOST}\r\n{authorization}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
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

#[tauri::command]
fn admin_request(state: State<'_, AdminToken>, method: String, path: String, body: Option<String>) -> Result<String, String> {
    if !allowed_endpoint(&method, &path) { return Err("Administrative endpoint is not allow-listed".into()); }
    let payload = action_payload(&method, &path, body.as_deref().unwrap_or("{}"))?;
    let token = state.0.lock().map_err(|_| "Token state unavailable")?.clone().ok_or_else(|| "Not authenticated".to_string())?;
    if !valid_token(&token) { return Err("Invalid stored admin token".into()); }

    let response = raw_http_request("POST", "/v1/control", Some(&token), &payload)?;
    let status_line = response.lines().next().unwrap_or("");
    if !status_line.starts_with("HTTP/1.1 200 ") && !status_line.starts_with("HTTP/1.1 503 ") {
        return Err(format!("Admin API error: {status_line}"));
    }
    let body_start = response.find("\r\n\r\n").ok_or_else(|| "Malformed Admin API response".to_string())? + 4;
    let response_body = &response[body_start..];
    let _: Value = serde_json::from_str(response_body).map_err(|_| "Invalid Admin API JSON".to_string())?;
    Ok(response_body.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AdminToken(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![set_token, load_stored_token, bootstrap_token, clear_token, forget_token, admin_request])
        .run(tauri::generate_context!())
        .expect("error while running MERCORA Admin Console");
}
