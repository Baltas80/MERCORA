# Admin Console implementation status

Updated 2026-09-29.

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

## Pending before production sign-off

- Real desktop Admin Console UI with the eight tabs wired to the Admin Control API beyond the currently implemented dashboard/infrastructure surface.
- Read-only dashboard/custody/catalog/orders/customers/store/security API projections against the real PostgreSQL schema.
- Panic Mode persistence and state machine in PostgreSQL.
- Emergency sweep planner wired to `server/custody/` through its authenticated internal RPC boundary.
- Emergency destination registry and per-asset validation for BTC/XMR.
- Immutable audit-chain migration and verification endpoint.
- Fresh WebAuthn/TOTP step-up enforcement for emergency actions; the login TOTP challenge is implemented, but emergency-action step-up is not yet complete.
- Service-manager integration for Windows start/stop/status/recovery where Docker is not the execution boundary.
- End-to-end tests against a real PostgreSQL/Tor test environment.
- Windows packaging and installer verification.

## Secret policy

The console must never return private keys, seeds, mnemonics, wallet credentials or HSM/signing material. Encrypted custody material remains outside the console and is accessed only by the isolated custody service. Emergency operations request a fixed custody operation; they never receive key material.

## Verification note

Repository-level inspection and implementation were performed against the current `master` branch. The Admin Control tests cover targeted recovery, dependency blocking, ordered verification and diagnostic sanitisation. New Tauri tests cover extraction of rotated session cookies without retaining cookie attributes. GitHub Actions was triggered for the implementation commits; runtime execution against the local Docker/PostgreSQL/Tor stack and physical Windows packaging remain pending because the repository connector cannot start that local environment.
