# MERCORA Admin Console

## Purpose

The Admin Console is a separate desktop control plane for MERCORA. It is not part of the public marketplace and must not depend on the public web being healthy in order to recover it.

Target architecture:

```text
Windows Admin Console
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

## Current foundation

- `server/admin-control.js`: localhost-only administrative API with bearer-token authentication and a fixed action allow-list.
- `scripts/mercora-service.sh`: WSL process manager for the current Node.js application.
- `scripts/tor-service-wsl.sh`: WSL Tor process manager with configuration validation and no key generation/replacement.
- `scripts/start-onion-wsl.sh`: existing staging launcher remains available for initial Onion Service setup.

## Security boundaries

- The Admin Control API binds to `127.0.0.1` by default.
- Requests require `MERCORA_ADMIN_CONTROL_TOKEN`.
- Only pre-defined service actions are accepted; arbitrary shell commands are not accepted.
- PostgreSQL is not exposed by the Admin API.
- Onion Service private keys are never returned by the API.
- Secrets must be supplied through the environment/secure secret storage and never committed.

## Development

Set a strong local token before starting the control API:

```bash
export MERCORA_ADMIN_CONTROL_TOKEN='use-a-long-random-secret'
npm run admin:control
```

The API defaults to `http://127.0.0.1:8090`.

Status endpoint:

```text
GET /api/admin/status
Authorization: Bearer <token>
```

Action endpoint accepts only the allow-listed action names implemented in `server/admin-control.js`.

## Recovery model

Recovery must be component-aware. Prefer restarting the failed component rather than restarting the entire stack. After every recovery operation, perform dependency checks and an application health check.

The current WSL service manager deliberately refuses to force-kill a process that does not stop gracefully. Production orchestration should provide an explicit, separately audited escalation policy rather than silently using `SIGKILL`.

## Production status

This is the control-plane foundation, not a finished production desktop application. A Windows desktop shell, OS credential storage, MFA, signed application updates, richer health checks, PostgreSQL health checks, audit persistence, and production deployment controls remain to be implemented and tested.
