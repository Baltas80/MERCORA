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

## Authentication

The Admin Control API uses the production Better Auth session stack. Login is username/password based and only an authenticated user with the `admin` role can invoke control operations.

The API binds to `127.0.0.1:8787` by default and rejects non-loopback clients. Authentication requests are rate-limited by the authentication layer. The API does not expose an administrator bearer token and does not accept arbitrary command strings.

Initial owner provisioning is a separate, one-time bootstrap operation protected by the owner bootstrap token. After an administrator exists, owner bootstrap is permanently disabled for that installation.

## Privileged control boundary

The Admin Control API accepts only the six operations above and only the service names `app`, `postgres`, and `tor`. Docker is invoked through Node.js `execFile` with `shell: false`; command arguments are constructed from fixed allowlists.

No interface field is converted into a shell command. Invalid actions and service names are rejected before Docker is invoked.

Requests larger than 4 KiB are rejected before authentication/control execution. Responses use defensive headers including `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY`.

Diagnostics are truncated and filtered to remove common secret-bearing lines and embedded credentials before they are returned to the console.

## Recovery model

`RECOVER` with an explicit component repairs only that requested component first. A failed restart falls back to starting that same component.

`RECOVER` without a component first performs a health diagnosis and selects only the affected component in dependency order: PostgreSQL, backend/app, then Tor. If the entire stack is healthy, no restart is performed. It does not restart the entire stack unnecessarily.

Before any recovery Docker operation, the controller performs a non-secret Compose configuration preflight. The current Compose stack requires `POSTGRES_PASSWORD`; the preflight accepts that variable from the Admin Control process environment or from the project `.env` file used by Docker Compose. If it is missing or empty, recovery is blocked before Docker is invoked and the console receives only the configuration diagnosis, never the password value.

After a targeted repair, the controller verifies the operational chain:

1. Required Compose configuration.
2. Node.js and Docker availability.
3. Backend health.
4. PostgreSQL readiness.
5. Required Compose services, including Tor.
6. Onion Service hostname availability.
7. Persistent storage definition (`postgres_data`) from the active Compose configuration.
8. Aggregate health.

`HEALTH_CHECK` invokes this same full diagnostic path directly. It does not merely execute `docker compose ps`, so the console receives backend, database, Tor, Onion Service, storage, configuration, Node.js, Docker, and aggregate health results.

The storage check deliberately does not assume Docker's project-name prefix, so `COMPOSE_PROJECT_NAME` or a different working-directory name cannot create a false storage failure.

The recovery result includes the target component, whether the targeted repair succeeded, whether that target passed its health criteria, and the sanitized verification results.

## Tor / Onion Service runtime requirement

The Tor Compose override uses `svengo/tor:0.4.9.11-1`. That image's entrypoint creates `/etc/tor/torrc-defaults` during startup, so the Tor service must not use a global container `read_only: true` filesystem setting.

The Tor service retains `no-new-privileges`, drops all Linux capabilities, keeps the persistent `tor_data` volume, and mounts the application Tor configuration read-only at `/data/torrc`. The base `app` and PostgreSQL services retain their existing hardening.

## Verification

- **IMPLEMENTED:** allowlisted START/STOP/RESTART/STATUS/HEALTH_CHECK/RECOVER operations.
- **IMPLEMENTED:** loopback-only Admin Control API.
- **IMPLEMENTED:** Better Auth username/password session authentication with admin-role authorization.
- **IMPLEMENTED:** targeted recovery with diagnosis-first selection when no component is specified.
- **IMPLEMENTED:** no-restart path when the stack is already healthy.
- **IMPLEMENTED:** Compose configuration preflight before recovery Docker operations.
- **IMPLEMENTED:** Compose `.env` fallback detection without returning secret values.
- **IMPLEMENTED:** regression tests for targeted recovery and missing/valid Compose configuration.
- **IMPLEMENTED:** project-name-independent persistent-storage health check.
- **IMPLEMENTED:** `HEALTH_CHECK` full diagnostic path rather than a plain Compose status query.
- **IMPLEMENTED:** secret-safe diagnostic sanitization.
- **IMPLEMENTED:** no-shell Docker invocation.
- **IMPLEMENTED:** Tor startup compatibility fix for the selected image.
- **IMPLEMENTED:** platform-neutral owner-bootstrap path test.
- **PENDING:** CI result for the latest recovery hardening commits.
- **PENDING:** live Windows runtime verification of PostgreSQL + backend + Tor + Onion Service after the Tor compose change.
