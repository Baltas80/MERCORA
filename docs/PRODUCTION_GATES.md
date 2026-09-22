# MERCORA — Production Gates

This document records the evidence required before the administrative control plane is considered production-ready. It does not treat code presence as proof of runtime readiness.

## Current gates

| Gate | Status | Evidence required |
|---|---|---|
| Admin Control API localhost binding | IMPLEMENTED | Automated unit/security tests and CI |
| Explicit admin endpoint/action allowlists | IMPLEMENTED | Source review + tests |
| Diagnostic secret/path filtering | IMPLEMENTED | `server/admin-control-api.test.js` |
| Directed recovery | IMPLEMENTED | Controller tests + real runtime test |
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

## Rule

A gate marked `IMPLEMENTED` means the corresponding code/control exists. It does **not** mean that production validation has passed. A gate becomes production-verified only after the required evidence is available.

The Admin Control API rejects POST bodies larger than 32 KiB using both an early `Content-Length` check and a streaming byte-count check. Oversized requests are drained before the 413 response is returned, preventing unread request data from being left on the connection.

No secrets, Onion private keys, database dumps, wallet keys, or credentials belong in this repository.
