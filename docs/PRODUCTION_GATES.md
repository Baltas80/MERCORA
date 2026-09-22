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
| Rust Admin Console tests | PENDING | Dedicated Linux Rust CI job must complete successfully on current head |
| Windows Admin Console build | PENDING | Successful Windows CI build producing `.exe` or `.msi` artifact |
| Windows backup-task installer | PENDING | Successful Windows installation and scheduled execution on target host |
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

The general CI workflow grants `contents: read` globally. `security-events: write` is restricted to the CodeQL job instead of being granted to the unit/security job. All jobs have explicit execution timeouts to prevent stalled dependency resolution, builds, audits, or tests from consuming an unbounded runner allocation.

The CI has a dedicated `admin-console-rust` job. It installs the Linux dependencies required by Tauri, resolves the Rust dependency lockfile in the runner when the repository does not yet contain one, checks Rust formatting, and runs `cargo test --locked` against `admin-console/src-tauri`. The repository should add and review the generated `Cargo.lock` before claiming full dependency reproducibility.

The CI also has a dedicated `admin-console-windows-build` job. It installs the pinned Tauri CLI declared by `admin-console/package.json`, builds the Windows application on a Windows runner, and fails unless an `.exe` or `.msi` bundle is produced.

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

A dedicated `scripts/mercora-backup-scheduler.mjs` performs an immediate backup when started and then repeats every six hours by default. The interval cannot be configured below 15 minutes. Retention defaults to seven days and 28 backups, with configurable bounded values. The scheduler prevents overlapping backup cycles and prunes only validated regular files inside the managed backup directory. Backups are excluded from Git by `backups/` in `.gitignore`.

Restore-path unit coverage verifies the destructive-operation ordering: the backend is stopped before the pre-restore safety backup, the requested archive is restored through the managed-file stream, the backend is started again even when restore fails, and the final audit event is emitted. The production gate remains pending because these tests do not replace an end-to-end PostgreSQL runtime restore test.

On Windows, `scripts/install-mercora-backup-task.ps1` installs the scheduler for the invoking user using an S4U principal with `Limited` run level. It explicitly rejects execution under SYSTEM. This avoids granting the Node.js scheduler a machine-wide elevated token. The task is intentionally separate from the public web process. The target account must have the minimum Docker access required by the real deployment; that permission and actual scheduled execution remain pending target-host validation.
