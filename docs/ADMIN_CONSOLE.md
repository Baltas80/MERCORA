# MERCORA Admin Console

The Windows Admin Console is a Tauri 2 desktop operator interface for the local MERCORA Admin Control API.

## Architecture

`Admin UI -> Tauri/Rust bridge -> 127.0.0.1 Admin Control API -> allow-listed privileged operations`

The UI does not expose a command shell. The bridge accepts only the status and action endpoints. It keeps the active credential in process memory and persists it through Windows Credential Manager so the next launch can reconnect without a manual copy/paste.

## First launch

When the Admin Control API is started without `MERCORA_ADMIN_TOKEN`, it generates a random 32-byte credential and stores it in per-user local state outside the repository. The first-run bootstrap remains pending until the desktop console claims it through the loopback-only `POST /v1/bootstrap` endpoint.

The console's **INITIALIZE LOCAL CREDENTIAL** action receives the credential through the localhost bridge and immediately stores it in Windows Credential Manager. The secret is not shown in the UI, committed to GitHub, or embedded in the NSIS installer.

When a credential already exists in Windows Credential Manager, the console loads it at startup and attempts to connect automatically. **LOCK** clears only the active in-memory session; it does not destroy the saved credential. **UNLOCK SAVED CREDENTIAL** reloads that credential without displaying it.

For environments that deliberately use an explicit `MERCORA_ADMIN_TOKEN`, the manual token field remains available and bootstrap is disabled.

## Operator functions

- START / STOP / RESTART MERCORA
- START / STOP / RESTART PostgreSQL
- START / STOP / RESTART Tor
- RECOVER MERCORA
- RECOVER PostgreSQL
- RECOVER Tor
- HEALTH CHECK
- LOCK / UNLOCK saved credential

## Windows build

The `Admin Console` GitHub Actions workflow runs on Windows, checks Rust and JavaScript, builds the Tauri NSIS installer, and publishes the installer as a short-lived CI artifact.

## Runtime gate

A successful source/CI build does not prove that a particular Windows/WSL installation has working Docker, PostgreSQL or Tor. Those live-environment checks must be executed on the target machine before production sign-off.
