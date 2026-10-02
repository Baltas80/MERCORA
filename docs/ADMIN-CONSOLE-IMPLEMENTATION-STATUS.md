# Admin Console implementation status

Updated 2026-10-02.

## Implemented / verified in repository

- Loopback-only Admin Control API boundary.
- Better Auth admin-role gate before privileged control operations.
- Administrator TOTP challenge is now exposed by the desktop UI after password authentication.
- TOTP verification is routed only through the fixed `/api/admin/auth/verify-2fa` allowlist entry.
- Tauri preserves the authenticated cookie returned when Better Auth upgrades the temporary 2FA session.
- The UI verifies the resulting administrator session before opening the privileged console.
- Fixed allowlist for `START`, `STOP`, `RESTART`, `STATUS`, `HEALTH_CHECK`, `RECOVER`.
- Fixed service allowlist (`app`, `postgres`, `tor`); no arbitrary command endpoint.
- Diagnostic sanitisation for passwords, secrets, tokens, authorization data and credential URLs.
- Targeted recovery: the controller diagnoses first and restarts only the affected component.
- Dependency protection: application recovery is blocked when PostgreSQL is unhealthy.
- Ordered post-recovery verification for dependencies, backend, database, Tor, Onion Service and final health.
- Effective Tor configuration check verifies relay listeners are disabled and the exit policy rejects all traffic.
- PostgreSQL persistent-volume configuration is checked through the active Compose configuration.
- Custody asset contract is restricted to BTC and XMR.
- Architecture documentation defines the eight console tabs and the custody/emergency boundary.
- Windows service-manager boundary is implemented as an allowlisted PowerShell adapter for installations where Docker is not the execution boundary. It accepts only `START`, `STOP`, `RESTART`, `STATUS`, `HEALTH_CHECK`, `RECOVER` and only the fixed `backend`, `postgres`, `tor` service identities.
- Windows service-manager tests statically verify the action/service allowlists, absence of arbitrary command execution primitives, targeted recovery ordering and the fixed loopback backend health endpoint.
- Backend health probing no longer assumes a single host port. The Admin Control API first asks Docker Compose for the `app` service's published port, accepts only loopback bindings, probes `/api/healthz` through that published local URL, and falls back to a fixed in-container health probe if no safe published port is available.
- Backend probe diagnostics expose only HTTP status metadata and sanitized transport errors; response bodies are not surfaced by the desktop client.
- Unit coverage now verifies both the published-port path and the controlled in-container fallback path.
- Windows Admin Console packaging has been exercised by CI through the Tauri build workflow; the latest published installer is `admin-console-v0.1.129` from commit `1e72dd8258a2e61849c7e2961c4847345c84741f`.

## Pending before production sign-off

- Real desktop Admin Console UI with the eight tabs wired to the Admin Control API beyond the currently implemented dashboard/infrastructure surface.
- Read-only dashboard/custody/catalog/orders/customers/store/security API projections against the real PostgreSQL schema.
- Panic Mode persistence and state machine in PostgreSQL.
- Emergency sweep planner wired to `server/custody/` through its authenticated internal RPC boundary.
- Emergency destination registry and per-asset validation for BTC/XMR.
- Immutable audit-chain migration and verification endpoint.
- Fresh WebAuthn/TOTP step-up enforcement for emergency actions; the login TOTP challenge is implemented, but emergency-action step-up is not yet complete.
- Admin Control API integration with the Windows service-manager adapter and verification against the actual installed Windows service names.
- End-to-end tests against a real PostgreSQL/Tor test environment.
- A fresh Windows installer built from the current `master` commit after the latest server-side health-probe hardening; the existing `v0.1.129` installer predates those server-side changes because the Admin Console workflow is scoped to `admin-console/**`.

## Secret policy

The console must never return private keys, seeds, mnemonics, wallet credentials or HSM/signing material. Encrypted custody material remains outside the console and is accessed only by the isolated custody service. Emergency operations request a fixed custody operation; they never receive key material.

## Verification note

Repository-level inspection and implementation were performed against the current `master` branch. The Admin Control tests cover targeted recovery, dependency blocking, ordered verification, diagnostic sanitisation, the published local backend health path and the controlled in-container fallback. New Tauri tests cover extraction of rotated session cookies without retaining cookie attributes. The Windows service-manager test suite is repository-level/static and does not require privileged Windows services. Runtime execution against the local Docker/PostgreSQL/Tor stack, Windows service installation, physical packaging and end-to-end recovery remain pending because the repository connector cannot start that local environment.
