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

## First-run administrative credential

A fresh MERCORA Admin Control API instance now creates a cryptographically random 32-byte bearer token when no `MERCORA_ADMIN_TOKEN` environment variable is supplied. The generated credential is persisted outside the repository at a per-user state path and is marked as **bootstrap pending**.

On Windows the default path is under `%LOCALAPPDATA%\\MERCORA\\Admin\\admin-token.json`. On Unix-like systems it uses `$XDG_STATE_HOME/mercora/admin-token.json` or `~/.local/state/mercora/admin-token.json`.

The token file is created with restrictive file permissions where the operating system exposes them. The credential is never committed to Git, never baked into the installer, and is never printed. The Windows Admin Console performs the one-time localhost bootstrap and stores the resulting credential in Windows Credential Manager. Subsequent launches can load the stored credential without showing it in the UI.

The bootstrap endpoint is `POST /v1/bootstrap`, is localhost-only, returns the generated token only while bootstrap is pending, and permanently disables bootstrap for that credential after it is claimed. When an explicit `MERCORA_ADMIN_TOKEN` is configured, bootstrap is disabled and the console can use that configured token manually.

For automated/headless deployments, retain the existing explicit environment-variable path:

```text
MERCORA_ADMIN_TOKEN=<local-secret> npm run admin:api
```

Do not place the token in a script, Docker image, GitHub Actions file, repository secret committed to source, or installer resource.

## Existing control-plane guarantees

`RECOVER` first restarts only the requested component. If that fails, it attempts to start that same component. It then runs the health sequence rather than restarting unrelated services.

`STATUS` returns a structured, secret-free summary for MERCORA, Node.js, PostgreSQL, backend, Tor, Onion Service, storage, and overall health.

Authentication uses a length-checked constant-time token comparison. The API binds to `127.0.0.1:8787` by default and rejects non-loopback clients. Requests larger than 4 KiB are rejected before privileged operations.

The control implementation invokes `docker` with `execFile` and `shell: false`. Arguments are generated exclusively from fixed allowlists. No user-supplied command string is passed to a shell.

Diagnostics are truncated and filter common secret-bearing lines before they are returned to the console.

## Verification

- **IMPLEMENTED:** first-run random admin credential generation.
- **IMPLEMENTED:** credential persistence outside the repository.
- **IMPLEMENTED:** one-time localhost bootstrap.
- **IMPLEMENTED:** Windows Credential Manager storage for the desktop console.
- **IMPLEMENTED:** explicit environment-token mode for headless deployments.
- **IMPLEMENTED:** tests for generation, persistence, one-time bootstrap and environment mode.
- **PENDING:** live Windows installer build after the credential-store dependency is compiled and tested by CI.
- **PENDING:** live runtime health checks require the actual MERCORA Docker/PostgreSQL/Tor environment.
