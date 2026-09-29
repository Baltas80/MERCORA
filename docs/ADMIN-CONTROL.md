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

Diagnostics are truncated and filtered to remove common secret-bearing lines and embedded credentials before they are returned to the console. The native Admin Console adds a second disclosure boundary: non-success HTTP error bodies are never displayed by the desktop client, so a future API error path cannot accidentally expose implementation details or credentials through the UI.

## Recovery model

`RECOVER` with an explicit component repairs only that requested component first, but it now performs a full dependency diagnosis before changing anything. If the requested `app` depends on an unhealthy PostgreSQL service, app recovery is blocked and the console receives the dependency diagnosis instead of unnecessarily restarting the app. A failed restart falls back to starting that same component.

`RECOVER` without a component first performs a health diagnosis and selects only the affected component in dependency order: PostgreSQL, backend/app, then Tor. If the entire stack is healthy, no restart is performed. It does not restart the entire stack unnecessarily.

Before any recovery Docker operation, the controller performs a non-secret Compose configuration preflight. The current Compose stack requires `POSTGRES_PASSWORD`; the preflight accepts that variable from the Admin Control process environment or from the project `.env` file used by Docker Compose. If it is missing or empty, recovery is blocked before Docker is invoked and the console receives only the configuration diagnosis, never the password value.

After a targeted repair, the controller verifies the operational chain and exposes the verification as explicit ordered checkpoints:

1. Required Compose configuration, Node.js, Docker, and required running services.
2. Backend health.
3. PostgreSQL readiness.
4. Tor runtime/configuration.
5. Onion Service hostname availability.
6. Aggregate health.

The final recovery result contains only sanitized diagnostics. It does not expose command execution details beyond the fixed operation/checkpoint names, and the existing sanitizer remains the last disclosure boundary.

`HEALTH_CHECK` invokes the same full diagnostic path directly. It does not merely execute `docker compose ps`, so the console receives backend, database, Tor, Onion Service, storage, configuration, Node.js, Docker, and aggregate health results.

### Backend health probe

The Admin Control API does not depend on a host-published backend port for its backend health decision. It executes one fixed, non-interactive health probe inside the allowlisted `app` Compose service:

`docker compose -f docker-compose.yml -f docker-compose.onion.yml exec -T app node -e <fixed health probe>`

The fixed probe requests `http://127.0.0.1:8080/api/healthz` from inside the application container. No user-controlled command, URL, or service name is interpolated into the probe. This avoids false `fetch failed` results caused by differences in host port publishing while preserving the strict Admin Control privilege boundary.

For HTTP-level failures, the fixed probe reports only the HTTP status, status text, and boolean `ok` flag. Network/runtime failures are reported as the error name and message. It never returns the health endpoint body, response headers, cookies, authorization material, or application secrets. The existing diagnostic sanitizer still applies before data reaches the console.

The storage check deliberately does not assume Docker's project-name prefix, so `COMPOSE_PROJECT_NAME` or a different working-directory name cannot create a false storage failure.

## Tor / Onion Service runtime requirement

The observed Windows runtime showed the Tor image starting its default relay configuration: `ORPort 9001` and `DirPort 9030` were opened before the network bootstrap completed. For MERCORA this is incorrect: the service is an Onion Service, not a public Tor relay.

The Compose override now explicitly sets:

- `ORPORT=0`
- `DIRPORT=0`
- `EXITPOLICY=reject *:*`

The Tor image is pinned to `svengo/tor:0.4.9.12`, the newest version currently published by the selected image maintainer. Tor 0.4.9.12 is a security release; keeping MERCORA on the older 0.4.9.11 image would leave it behind a known upstream security update.

The Admin Control health check reads the effective application Tor configuration at `/data/torrc` inside the real Tor container and fails unless `ORPort` and `DirPort` are `0` and the effective policy is `ExitPolicy reject *:*`. This prevents a future image/default change from silently turning MERCORA into a relay again.

The Tor service retains `no-new-privileges`, drops all Linux capabilities, keeps the persistent `tor_data` volume, and mounts the application Tor configuration read-only at `/data/torrc`. The selected image's entrypoint creates `/etc/tor/torrc-defaults` during startup, so the Tor service must not use a global container `read_only: true` filesystem setting.

## CI / release security boundary

The main CI workflow has a repository-wide default of `contents: read`. CodeQL alone receives `security-events: write`; ordinary static-security, test, and Windows-build jobs do not receive that privilege. The workflow can run on pushes, pull requests, and manual `workflow_dispatch` invocations.

The CI action runtimes have been updated for the current GitHub-hosted runner environment: `actions/checkout@v6`, `actions/setup-node@v5`, `actions/upload-artifact@v7`, and `github/codeql-action@v4`. Node.js 22 remains the project runtime selected by the workflow; the action updates are specifically to avoid obsolete Node 20 action runtimes on current runners.

The Windows Admin Console job has only `contents: read`. It installs the Tauri dependencies, runs the Rust unit-test suite with `cargo test --lib`, builds the real Windows Tauri bundle, and uploads that bundle as a workflow artifact. There is currently no release-publishing job in this workflow; release publication is therefore not represented as an implemented CI capability and must not be treated as such.

The backend CI installation uses `npm ci` against the committed root lockfile. The Admin Console continues to use `npm install` because that subproject currently has no committed `package-lock.json`.

## Verification

- **IMPLEMENTED:** allowlisted START/STOP/RESTART/STATUS/HEALTH_CHECK/RECOVER operations.
- **IMPLEMENTED:** loopback-only Admin Control API.
- **IMPLEMENTED:** Better Auth username/password session authentication with admin-role authorization.
- **IMPLEMENTED:** targeted recovery with diagnosis-first selection when no component is specified.
- **IMPLEMENTED:** dependency-gated explicit app recovery; unhealthy PostgreSQL blocks an unnecessary app restart.
- **IMPLEMENTED:** no-restart path when the stack is already healthy.
- **IMPLEMENTED:** Compose configuration preflight before recovery Docker operations.
- **IMPLEMENTED:** Compose `.env` fallback detection without returning secret values.
- **IMPLEMENTED:** regression tests for targeted recovery and missing/valid Compose configuration.
- **IMPLEMENTED:** regression test for dependency-gated app recovery.
- **IMPLEMENTED:** project-name-independent persistent-storage health check.
- **IMPLEMENTED:** effective Tor relay-listener health check.
- **IMPLEMENTED:** Tor Compose override disables ORPort and DirPort.
- **IMPLEMENTED:** Tor image upgraded to `0.4.9.12`.
- **IMPLEMENTED:** `HEALTH_CHECK` full diagnostic path rather than a plain Compose status query.
- **IMPLEMENTED:** controlled in-container backend health probe.
- **IMPLEMENTED:** secret-safe diagnostic sanitization.
- **IMPLEMENTED:** sanitized HTTP status diagnostics for backend failures.
- **IMPLEMENTED:** no-shell Docker invocation.
- **IMPLEMENTED:** Tor startup compatibility fix for the selected image.
- **IMPLEMENTED:** platform-neutral owner-bootstrap path test.
- **IMPLEMENTED:** CI #581 completed successfully for the backend diagnostic change.
- **IMPLEMENTED:** Windows Admin Console build is a required CI job and publishes the real Tauri Windows bundle as a workflow artifact.
- **IMPLEMENTED:** native Admin Console error-body disclosure defense with regression tests.
- **IMPLEMENTED:** explicit ordered post-recovery verification checkpoints with regression coverage for ordering and secret-safe diagnostics.
- **IMPLEMENTED:** Windows CI build job restricted to `contents: read`.
- **IMPLEMENTED:** main CI default token permissions restricted to `contents: read`; CodeQL retains only its required `security-events: write` permission.
- **IMPLEMENTED:** root CI dependency installation uses `npm ci` against the committed root lockfile.
- **IMPLEMENTED:** Admin Console CI retains `npm install` because no `admin-console/package-lock.json` is currently committed.
- **IMPLEMENTED:** Rust Admin Console unit tests are now an explicit CI gate before Windows packaging.
- **IMPLEMENTED:** CI supports manual `workflow_dispatch` execution for validation when an operator needs to rerun the complete workflow.
- **IMPLEMENTED:** GitHub Actions versions updated to current Node 24-compatible action runtimes across CI and visual-preview workflows.
- **PENDING:** authoritative CI execution for the latest workflow commits must still be observed after the pushes; the available commit-run endpoint currently returns no run for the new commits.
- **PENDING:** local execution of the Rust Admin Console unit tests in this environment because the execution host cannot resolve `github.com` and therefore cannot clone/build the Tauri project locally.
- **PENDING:** validation of the Windows bundle on the physical Windows/Docker environment, including HEALTH CHECK and RECOVER against the live stack.
- **PENDING:** live Tor origin-leak/edge integration evidence remains a production gate; the existing issue requires an isolated Onion Service deployment and machine-readable CI/manual evidence before this can be considered closed.
