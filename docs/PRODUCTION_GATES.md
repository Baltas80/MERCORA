# MERCORA — Production Gates

This document records the evidence required before the administrative control plane is considered production-ready. It does not treat code presence as proof of runtime readiness.

## Current gates

| Gate | Status | Evidence required |
|---|---|---|
| Admin Control API localhost binding | IMPLEMENTED | Automated unit/security tests and CI |
| Explicit admin endpoint/action allowlists | IMPLEMENTED | Source review + tests |
| Diagnostic secret/path filtering | IMPLEMENTED | `server/admin-control-api.test.js` |
| Directed recovery | IMPLEMENTED | `server/admin-control.test.js` + real runtime test |
| Recovery verification order | IMPLEMENTED | `server/admin-control.test.js` + real runtime test |
| Request body size enforcement and safe draining | IMPLEMENTED | `server/admin-control-api.test.js` + CI |
| Tauri endpoint isolation | IMPLEMENTED | Rust source review + `cargo test` |
| Rust Admin Console tests | PENDING | GitHub Actions run for current head |
| Windows installer | PENDING | Successful Windows build artifact |
| Docker/WSL runtime | PENDING | Runtime validation on target host |
| PostgreSQL backup/verify/restore | PENDING | End-to-end runtime test |
| Scheduled PostgreSQL backups | IMPLEMENTED | Scheduler unit tests + Windows Task Scheduler installation; target-host execution still required |
| Backup retention | IMPLEMENTED | Scheduler retention tests + filesystem confinement checks |
| Backup path/symlink confinement | IMPLEMENTED | `server/admin-system.test.js` + target-host filesystem test |
| Privileged command timeout bounds | IMPLEMENTED | Source review + CI tests; runtime drill still required |
| Tor runtime | PENDING | Target-host Tor health check |
| Onion Service | PENDING | Real Onion Service reachability test |
| Authenticated payment flow | PENDING | End-to-end authenticated test |
| Wallet/custody isolation | PENDING | Isolated service + reconciliation evidence |
| Blockchain observation/reconciliation | PENDING | End-to-end runtime test |
| Withdrawals | PENDING | Controlled integration test |
| RBAC/MFA | PENDING | Security tests and runtime verification |
| Final recovery/security review | PENDING | Full operational drill |

## CI security baseline

The general CI workflow grants `contents: read` globally. `security-events: write` is restricted to the CodeQL job instead of being granted to the unit/security job. Both jobs have explicit execution timeouts to prevent a stalled dependency audit or test suite from consuming an unbounded runner allocation.

## Recovery contract

`RECOVER` is restricted to the fixed service allowlist (`app`, `postgres`, `tor`). It first restarts only the requested component and falls back to starting that same component if restart fails. It never performs a broad restart as a recovery fallback. After a successful component repair, the controller runs health verification in this order: Node/runtime dependencies, Docker, Compose/MERCORA, backend, PostgreSQL, Tor, Onion Service, and storage. The final health state is returned to the Admin Console. Diagnostics are sanitized before crossing the Admin Control API boundary.

## Admin action boundary

Every privileged Admin Control API family has its own fixed action allowlist before dispatch:

- control: `START`, `STOP`, `RESTART`, `STATUS`, `HEALTH_CHECK`, `RECOVER`;
- management: fixed marketplace/admin actions defined by `admin-management.js`;
- reputation: fixed seller/review actions defined by `admin-reputation.js`;
- escrow: fixed custody/authorization actions defined by `admin-escrow.js`;
- system: fixed logs/metrics/database maintenance actions;
- content: fixed versioned site-content actions.

An action not present in the API allowlist is rejected before the corresponding privileged manager is invoked. This is an explicit boundary in addition to validation inside the individual managers. The UI therefore has no route to an arbitrary shell, SQL statement, filesystem path, or manager method through an uncontrolled action name.

## Rule

A gate marked `IMPLEMENTED` means the corresponding code/control exists. It does **not** mean that production validation has passed. A gate becomes production-verified only after the required evidence is available.

The Admin Control API rejects POST bodies larger than 32 KiB using both an early `Content-Length` check and a streaming byte-count check. Oversized requests are drained before the 413 response is returned, preventing unread request data from being left on the connection.

No secrets, Onion private keys, database dumps, wallet keys, or credentials belong in this repository.

## Backup safety and schedule

Backup identifiers are constrained to the generated `mercora-<UTC>-<random>.dump` format. Before `pg_restore` input is opened, the service resolves the managed backup directory and the requested file with `realpath`, requires the resolved path to remain inside the managed directory, and requires a regular file. This also blocks symlink-based escapes. Listing ignores entries that fail the same managed-file check.

Privileged Docker operations have bounded execution time. General administrative commands and backup verification default to a two-minute timeout; backup generation and database restoration have a fifteen-minute limit. A timeout is returned as a sanitized diagnostic and does not expose process arguments or secrets. Runtime validation on the target host remains required.

A dedicated `scripts/mercora-backup-scheduler.mjs` now performs an immediate backup when started and then repeats every six hours by default. The interval cannot be configured below 15 minutes. Retention defaults to seven days and 28 backups, with configurable bounded values. The scheduler prevents overlapping backup cycles and prunes only validated regular files inside the managed backup directory. Backups are excluded from Git by `backups/` in `.gitignore`.

On Windows, `scripts/install-mercora-backup-task.ps1` installs the scheduler as a SYSTEM Task Scheduler job, configured by default for every six hours and to start when available. The task is intentionally separate from the public web process and therefore does not grant Docker privileges to the web application.
