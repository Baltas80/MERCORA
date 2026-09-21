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
- `.github/workflows/ci.yml`: includes a Windows runner that checks Rust and builds the Tauri NSIS installer as a short-lived CI artifact.
- `admin-console/src-tauri/icons/icon.ico`: Windows application icon required by `tauri-build`.

The desktop client keeps the administrator token only in the running Tauri process and sends administrative requests through the Rust bridge to `127.0.0.1:8090`. It does not write the token to the UI's local storage.

Tauri's global JavaScript API is enabled because the current UI uses the documented `window.__TAURI__.core.invoke` bridge. The exposed operations remain limited to the explicitly registered Rust commands (`set_token`, `clear_token`, and `admin_request`); the Rust bridge itself allow-lists the Admin Control API endpoints and never exposes arbitrary shell execution.

## Security boundaries

- The Admin Control API binds to `127.0.0.1` by default.
- Requests require `MERCORA_ADMIN_CONTROL_TOKEN`.
- Only pre-defined service actions are accepted; arbitrary shell commands are not accepted.
- PostgreSQL is not exposed by the Admin API.
- Onion Service private keys are never returned by the API.
- Secrets must be supplied through the environment/secure secret storage and never committed.
- The desktop UI cannot directly open a shell or invoke arbitrary system commands.
- The desktop Rust bridge validates request methods/paths, limits request and response sizes, applies network timeouts, and stores the admin token only in process memory.
- Mutating operations are serialized so two lifecycle-changing actions cannot execute concurrently.
- Recovery is implemented as an explicit allow-listed workflow; it does not accept commands, paths or scripts from the UI.

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

## Windows build

The repository CI performs a real Windows Tauri build on `windows-latest` for pull requests. The build uses the published Tauri 2.6.2 CLI/core versions, checks the Rust application, builds the NSIS installer, and publishes the generated `.exe` as a CI artifact for 14 days.

The local equivalent is:

```powershell
cd admin-console
npm install --no-audit --no-fund
npm run build
```

This produces the Windows installer under:

```text
admin-console/src-tauri/target/release/bundle/nsis/
```

The installer build is not considered an end-to-end runtime test: the installed application still needs to be exercised against the target Windows/WSL/Tor environment.

## Status and recovery

The dashboard requests `GET /api/admin/status` and can issue only allow-listed actions through `POST /api/admin/action`.

Available actions include:

- start / stop / restart / status / health for MERCORA;
- torStart / torStop / torRestart / torStatus / torValidate for Tor;
- recover for a component-aware recovery pass.

Recovery follows this order:

1. inspect MERCORA;
2. start MERCORA only when it is stopped;
3. inspect Tor;
4. start Tor only when it is stopped;
5. collect final MERCORA/Tor/backend/PostgreSQL/storage/health status.

A failed dependency stops the recovery sequence and returns the stage diagnostics without exposing secrets. Recovery deliberately does not force-kill processes and does not restart healthy components unnecessarily.

The Onion Service status shown by the console is intentionally conservative: `CONFIGURED` means Tor is running and the expected v3 service identity file exists. It does **not** claim external Onion reachability has been proven. Live end-to-end Onion reachability remains a target-machine verification step.

The current WSL service manager deliberately refuses to force-kill a process that does not stop gracefully. Production orchestration should provide an explicit, separately audited escalation policy rather than silently using `SIGKILL`.

## Verification status

The Windows build had previously failed before Rust compilation because the branch was missing `admin-console/src-tauri/icons/icon.ico`. The required icon is now committed on the Admin Console branch; the next Windows CI execution must verify the corrected build.

The following remain pending until executed on the target machine:

- installed Tauri application startup;
- live Admin Control API startup;
- live Node.js start/stop/restart through the console;
- live Tor start/stop/restart and Onion Service reachability verification;
- live PostgreSQL health verification;
- end-to-end recovery tests;
- OS credential-store integration;
- MFA;
- signed desktop updates;
- persistent administrative audit storage.

These are intentionally not represented as passed tests.
