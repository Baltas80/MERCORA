# MERCORA Admin Control Plane

The administrative path is intentionally separated:

`Admin Console -> localhost Admin Control API -> allowlisted operations -> Docker Compose`

The admin surface does **not** expose a shell or arbitrary command execution.

## Operations

- `STATUS`
- `START [app|postgres|tor]`
- `STOP [app|postgres|tor]`
- `RESTART [app|postgres|tor]`
- `HEALTH_CHECK`
- `RECOVER [app|postgres|tor]`

`RECOVER` first restarts only the requested component. If that fails, it attempts to start that same component. It then runs the health sequence rather than restarting unrelated services.

## Local API

The API binds to `127.0.0.1` only and requires `MERCORA_ADMIN_TOKEN` with at least 32 characters. The implementation now rejects non-local bind addresses at construction time as an additional fail-closed boundary. The token must be supplied through the process environment and must never be committed to the repository.

Start it from the repository root:

```text
MERCORA_ADMIN_TOKEN=<local-secret> npm run admin:api
```

The console client uses the same token:

```text
MERCORA_ADMIN_TOKEN=<local-secret> npm run admin -- STATUS
MERCORA_ADMIN_TOKEN=<local-secret> npm run admin -- RESTART app
MERCORA_ADMIN_TOKEN=<local-secret> npm run admin -- RECOVER postgres
MERCORA_ADMIN_TOKEN=<local-secret> npm run admin -- HEALTH_CHECK
```

On Windows PowerShell, set the environment variable for the current session before running the commands. Do not place the token in a script checked into Git.

## Health coverage

The health sequence checks:

1. Node.js availability;
2. Docker Compose service state for the base and Onion configurations;
3. Docker daemon availability;
4. backend `GET /api/healthz` on the local application binding;
5. Onion Service hostname file inside the Tor data volume;
6. PostgreSQL Docker volume presence.

Diagnostics are truncated and filter common secret-bearing lines before they are returned to the console.

## Privilege boundary

The control implementation invokes `docker` with `execFile` and `shell: false`. Arguments are generated exclusively from fixed allowlists. No user-supplied command string is passed to a shell.

The control API is fail-closed to localhost binding and must remain local-only. Do not bind it to `0.0.0.0`, publish its port through Tor, or place it behind the public MERCORA web server.

## Verification status

- **IMPLEMENTED:** allowlisted control operations.
- **IMPLEMENTED:** local authenticated control API.
- **IMPLEMENTED:** component-targeted recovery.
- **IMPLEMENTED:** secret-filtered diagnostics.
- **IMPLEMENTED:** fail-closed localhost-only API binding.
- **TEST ADDED:** non-local bind attempts are rejected.
- **PENDING:** full repository `npm test` and live Docker/Tor health checks require the actual MERCORA runtime environment with Docker available.
