# MERCORA Admin Console

The Windows Admin Console is a Tauri 2 desktop operator interface for the local MERCORA Admin Control API.

## Architecture

`Admin UI -> Tauri/Rust bridge -> 127.0.0.1 Admin Control API -> allow-listed privileged operations`

The UI does not expose a command shell. The Rust bridge accepts only the allow-listed status/action endpoints and the fixed authentication routes used by the login/logout flow. Administrative operations are constrained to `START`, `STOP`, `RESTART`, `STATUS`, `HEALTH_CHECK` and `RECOVER`, with services limited to `app`, `postgres` and `tor`.

The Admin Control API is loopback-only and authenticates operators through the production Better Auth session. The desktop bridge keeps the active session cookie in process memory; credentials are never placed in the repository or sent to arbitrary endpoints.

## Operator functions

- START / STOP / RESTART MERCORA (entire real stack)
- START / STOP / RESTART PostgreSQL
- START / STOP / RESTART Tor
- RECOVER MERCORA (diagnosis-first, targeted repair)
- RECOVER PostgreSQL
- RECOVER Tor
- HEALTH CHECK
- LOCK session

The status dashboard exposes MERCORA, Node.js, PostgreSQL, Tor, Backend, Onion Service, Storage and aggregate Health Checks as separate states.

## Recovery contract

`RECOVER MERCORA` without an explicit component first runs the real health checks and selects only the first affected component in dependency order: PostgreSQL, backend/app, then Tor. A healthy stack is not restarted. Component-specific recovery remains available when an operator explicitly selects PostgreSQL or Tor.

After any targeted repair, verification runs in this order:

1. Runtime dependencies (Node.js and Docker)
2. Backend
3. PostgreSQL
4. Running service state, including Tor
5. Onion Service
6. Supporting storage invariant and aggregate health result

If the targeted restart fails, the controller attempts a targeted start of the same component. Diagnostics returned to the console are sanitized so credential-bearing lines and embedded credentials are not exposed.

## Security boundary

The console cannot execute arbitrary commands. The Tauri bridge sends only fixed, validated administrative actions to the loopback Admin Control API. The server-side controller invokes Docker with `execFile`, `shell:false`, a fixed Compose file set and an allow-listed service set.

The Tor service retains `no-new-privileges`, drops all Linux capabilities, keeps its persistent data in a dedicated volume, and mounts the Tor configuration read-only. The global `read_only` flag is intentionally not applied to the Tor container because its entrypoint must initialize `/etc/tor/torrc-defaults` during startup.

## Windows build

The `Admin Console` GitHub Actions workflow runs on Windows, checks Rust and JavaScript, builds the Tauri NSIS installer, and publishes the installer as a CI artifact.

## Runtime gate

A successful source/CI build does not prove that a particular Windows/Docker installation has working PostgreSQL, backend, Tor or Onion Service. Those live-environment checks must be executed on the target machine before production sign-off.
