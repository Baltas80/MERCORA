# MERCORA Admin Console

## Purpose

The Admin Console is a separate Windows desktop control plane for MERCORA. It is not part of the public marketplace and must not depend on the public web being healthy in order to recover it.

Target architecture:

```text
Windows Admin Console (Tauri)
        |
        v
Local Admin Control API (127.0.0.1)
        |
        v
Allow-listed Service Manager
        |
   +----+---------+
   |              |
   v              v
MERCORA        Tor Onion Service
   |
   v
PostgreSQL
```

## Current implementation

- `admin-console/`: Tauri desktop application for Windows, with a dark/premium administrative dashboard.
- `server/admin-control.js`: localhost-only administrative API with bearer-token authentication and a fixed action allow-list.
- `scripts/mercora-service.sh`: WSL process manager for the current Node.js application.
- `scripts/tor-service-wsl.sh`: WSL Tor process manager with configuration validation and no key generation/replacement.
- `scripts/start-onion-wsl.sh`: existing staging launcher remains available for initial Onion Service setup.

The desktop client keeps the administrator token only in the running Tauri process and sends administrative requests through the Rust bridge to `127.0.0.1:8090`. It does not write the token to the UI's local storage.

## Security boundaries

- The Admin Control API binds to `127.0.0.1` by default.
- Requests require `MERCORA_ADMIN_CONTROL_TOKEN`.
- Only pre-defined service actions are accepted; arbitrary shell commands are not accepted.
- PostgreSQL is not exposed by the Admin API.
- Onion Service private keys are never returned by the API.
- Secrets must be supplied through the environment/secure secret storage and never committed.
- The desktop UI cannot directly open a shell or invoke arbitrary system commands.

## Development

Set a strong local token before starting the control API:

```bash
export MERCORA_ADMIN_CONTROL_TOKEN='use-a-long-random-secret'
npm run admin:control
```

Then, from the repository root, start the desktop application:

```bash
npm run admin:desktop
```

The API defaults to `http://127.0.0.1:8090` and the MERCORA service manager defaults to `127.0.0.1:8080`.

## Status and recovery

The dashboard requests `GET /api/admin/status` and can issue only allow-listed actions through `POST /api/admin/action`.

Available actions include:

- start / stop / restart / status / health for MERCORA;
- torStart / torStop / torRestart / torStatus / torValidate for Tor.

Recovery must be component-aware. Prefer restarting the failed component rather than restarting the entire stack. After every recovery operation, perform dependency checks and an application health check.

The current WSL service manager deliberately refuses to force-kill a process that does not stop gracefully. Production orchestration should provide an explicit, separately audited escalation policy rather than silently using `SIGKILL`.

## Verification status

Source-level integration has been added, but this repository execution environment does not provide the user's live WSL/Windows desktop runtime. Therefore the following remain pending until executed on the target machine:

- Tauri Windows build and installer generation;
- live Admin Control API startup;
- live Node.js start/stop/restart through the console;
- live Tor start/stop/restart and Onion Service health verification;
- live PostgreSQL health verification;
- end-to-end recovery tests;
- OS credential-store integration;
- MFA;
- signed desktop updates;
- persistent administrative audit storage.

These are intentionally not represented as passed tests.
