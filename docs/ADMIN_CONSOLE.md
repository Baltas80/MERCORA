# MERCORA Admin Console

The Windows Admin Console is a Tauri 2 desktop operator interface for the local MERCORA Admin Control API.

## Architecture

`Admin UI -> Tauri/Rust bridge -> 127.0.0.1 Admin Control API -> allow-listed privileged operations`

The UI does not expose a command shell. The bridge accepts only the status and action endpoints and keeps the admin token in process memory. The Admin Control API remains localhost-only.

## Operator functions

- START MERCORA
- STOP MERCORA
- RESTART MERCORA
- START/RESTART TOR
- RECOVER
- HEALTH CHECK
- LOCK/logout

Recovery is component-oriented. The control plane should repair the affected component first and then verify dependencies, backend, database, Tor, Onion Service and final health state.

## Windows build

The `Admin Console` GitHub Actions workflow runs on Windows, checks Rust and JavaScript, builds the Tauri NSIS installer, and publishes the installer as a short-lived CI artifact.

## Runtime gate

A successful source/CI build does not prove that a particular Windows/WSL installation has working Docker, PostgreSQL or Tor. Those live-environment checks must be executed on the target machine before production sign-off.
