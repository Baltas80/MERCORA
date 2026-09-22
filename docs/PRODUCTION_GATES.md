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

## Rule

A gate marked `IMPLEMENTED` means the corresponding code/control exists. It does **not** mean that production validation has passed. A gate becomes production-verified only after the required evidence is available.

The Admin Control API rejects POST bodies larger than 32 KiB using both an early `Content-Length` check and a streaming byte-count check. Oversized requests are drained before the 413 response is returned, preventing unread request data from being left on the connection.

No secrets, Onion private keys, database dumps, wallet keys, or credentials belong in this repository.
