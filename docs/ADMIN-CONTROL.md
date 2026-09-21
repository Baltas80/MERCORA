# MERCORA Admin Control Plane

The administrative path is intentionally separated:

`Admin Console -> Tauri/Rust bridge -> localhost Admin Control API -> allowlisted operations -> Docker Compose`

The admin surface does **not** expose a shell or arbitrary command execution.

## Operations

- `STATUS`
- `START [app|postgres|tor]`
- `STOP [app|postgres|tor]`
- `RESTART [app|postgres|tor]`
- `HEALTH_CHECK`
- `RECOVER [app|postgres|tor]`

`RECOVER` first restarts only the requested component. If that fails, it attempts to start that same component. A successful fallback is treated as a successful recovery. It then runs the health sequence rather than restarting unrelated services.

`STATUS` returns a structured, secret-free summary for MERCORA, Node.js, PostgreSQL, backend, Tor, Onion Service, storage, and overall health. It is derived from the same health probes rather than exposing raw Docker output to the UI.

## Local API

The API binds to `127.0.0.1:8787` by default and requires `MERCORA_ADMIN_TOKEN` with at least 32 characters. The token must be supplied through the process environment and must never be committed to the repository.

Authentication uses a length-checked constant-time token comparison. The API also accepts IPv4-mapped loopback addresses while continuing to reject non-loopback clients. Requests larger than 4 KiB are rejected before they reach privileged operations.

Start it from the repository root:

```text
MERCORA_ADMIN_TOKEN=<local-secret> npm run admin:api
```

The CLI uses the same authenticated local API:

```text
MERCORA_ADMIN_TOKEN=<local-secret> npm run admin -- STATUS
MERCORA_ADMIN_TOKEN=<local-secret> npm run admin -- RESTART app
MERCORA_ADMIN_TOKEN=<local-secret> npm run admin -- RECOVER postgres
MERCORA_ADMIN_TOKEN=<local-secret> npm run admin -- HEALTH_CHECK
```

On Windows PowerShell, set the environment variable for the current session before running the commands. Do not place the token in a script checked into Git.

The Windows Admin Console exposes only two virtual bridge operations to its UI:

- `GET /api/admin/status` -> fixed `POST /v1/control` request with `STATUS`.
- `POST /api/admin/action` -> validated `POST /v1/control` request with one allowlisted action and optional `app`, `postgres`, or `tor` service.

The Rust bridge performs the validation before forwarding to the local API. The browser UI cannot supply an arbitrary path, command, shell expression, or unallowlisted service.

## Health coverage

The health sequence checks:

1. Node.js availability;
2. Docker daemon availability;
3. Docker Compose service state for the base and Onion configurations;
4. PostgreSQL readiness;
5. backend `GET /api/healthz` on the local application binding;
6. Onion Service hostname file inside the Tor data volume;
7. PostgreSQL Docker volume presence.

The sequence is used after recovery to verify dependencies and affected services without performing an unnecessary full-system restart.

Diagnostics are truncated and filter common secret-bearing lines before they are returned to the console.

## Privilege boundary

The control implementation invokes `docker` with `execFile` and `shell: false`. Arguments are generated exclusively from fixed allowlists. No user-supplied command string is passed to a shell.

The control API must remain local-only. Do not bind it to `0.0.0.0`, publish its port through Tor, or place it behind the public MERCORA web server.

## Verification status

- **IMPLEMENTED:** allowlisted control operations.
- **IMPLEMENTED:** local authenticated control API.
- **IMPLEMENTED:** component-targeted recovery with restart-to-start fallback.
- **IMPLEMENTED:** successful fallback is reflected in recovery result state.
- **IMPLEMENTED:** structured infrastructure status.
- **IMPLEMENTED:** secret-filtered diagnostics.
- **IMPLEMENTED:** constant-time-compatible token verification and IPv4-mapped loopback handling.
- **IMPLEMENTED:** 4 KiB request-size enforcement.
- **IMPLEMENTED:** Tauri bridge/API endpoint alignment.
- **IMPLEMENTED:** UI action-to-operation mapping.
- **TESTED:** admin controller unit coverage includes allowlists, shell-injection rejection, targeted recovery, fallback recovery success, diagnostics filtering, and structured status mapping.
- **TESTED:** admin API coverage includes authentication, allowlisted validation, valid forwarding, and request-size rejection.
- **TESTED:** admin UI JavaScript syntax check was previously verified locally.
- **PENDING:** live Docker/PostgreSQL/Tor health checks require the actual MERCORA runtime environment with Docker available.
- **PENDING:** this execution cannot truthfully claim the new tests have run locally; GitHub Actions must execute the new commit before CI verification is marked passed.
