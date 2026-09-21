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

The HTTP API regression suite verifies authentication rejection, operation/service allowlisting, dedicated `HEALTH_CHECK` routing, the 4 KiB boundary, and defensive response headers.

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
3. that all required Compose services (`app`, `postgres`, `tor`) are actually **running**;
4. PostgreSQL readiness;
5. backend `GET /api/healthz` on the local application binding;
6. Onion Service hostname file inside the Tor data volume;
7. PostgreSQL Docker volume presence.

The Compose service check uses `docker compose ps --status running --services`, so a successful Docker/Compose command is no longer treated as proof that MERCORA is running. Missing required services make the overall health check fail and are reflected in the structured status.

The backend probe is dependency-injected for tests while production uses the real local `/api/healthz` endpoint.

The sequence is used after recovery to verify dependencies and affected services without performing an unnecessary full-system restart.

Diagnostics are truncated and filter common secret-bearing lines before they are returned to the console.

## Privilege boundary

The control implementation invokes `docker` with `execFile` and `shell: false`. Arguments are generated exclusively from fixed allowlists. No user-supplied command string is passed to a shell.

The control API must remain local-only. Do not bind it to `0.0.0.0`, publish its port through Tor, or place it behind the public MERCORA web server.

## CI and preview

The previous CI run completed successfully for CodeQL and the static-security job, including the existing unit-test suite. The visual preview workflow also completed successfully after being changed to package the frontend independently of GitHub Pages provisioning.

The latest controller change makes runtime service state explicit. The current test file now also exercises the HTTP control API boundary so the security properties are checked through the actual local server path rather than only through controller unit tests.

## Verification status

- **IMPLEMENTED:** allowlisted control operations.
- **IMPLEMENTED:** local authenticated control API.
- **IMPLEMENTED:** component-targeted recovery with restart-to-start fallback.
- **IMPLEMENTED:** successful fallback is reflected in recovery result state.
- **IMPLEMENTED:** structured infrastructure status.
- **IMPLEMENTED:** secret-filtered diagnostics.
- **IMPLEMENTED:** constant-time-compatible token verification and IPv4-mapped loopback handling.
- **IMPLEMENTED:** 4 KiB request-size enforcement.
- **IMPLEMENTED:** dependency-injected backend probe for deterministic controller tests.
- **IMPLEMENTED:** explicit running-state verification for `app`, `postgres`, and `tor`.
- **IMPLEMENTED:** regression test for a missing required Compose service.
- **IMPLEMENTED:** corrected oversized-request test.
- **IMPLEMENTED:** HTTP API regression coverage for authentication, allowlisting, health-check routing, request limits, and response headers.
- **IMPLEMENTED:** Tauri bridge/API endpoint alignment.
- **IMPLEMENTED:** UI action-to-operation mapping.
- **IMPLEMENTED:** visual preview artifact workflow independent of GitHub Pages site provisioning.
- **TESTED BY PRIOR CI:** secret scan, forbidden artifact checks, syntax checks, Compose security verification, dependency audit, CodeQL, and the previous unit-test suite.
- **PENDING:** CI execution for the latest controller/test/documentation commits.
- **PENDING:** live Docker/PostgreSQL/Tor health checks require the actual MERCORA runtime environment with Docker available.
