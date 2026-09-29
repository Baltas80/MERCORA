# MERCORA Emergency Control — implementation boundary

## Current implementation

The repository now defines a persistent control-plane model for emergency operations without placing signing material in PostgreSQL or the Admin Console:

- `emergency_destinations`: BTC/XMR emergency destination registry. Destinations are public operational data only; no private keys or wallet credentials are stored.
- `panic_operations`: auditable emergency-operation state machine with explicit requested/authorization/execution/final states.
- `admin_audit_chain`: append-only audit records with a previous-hash/event-hash chain contract.
- `server/admin-emergency-control.js`: fail-closed validation for admin payloads, panic transitions and BTC/XMR sweep request shape.

## Security boundary

The Admin Console must only receive public operational state. The following fields are prohibited from the control plane:

- private keys
- seeds / mnemonics
- wallet credentials
- HSM material
- signing material
- passwords, secrets, tokens or authorization data

The emergency operation is represented as a request for a fixed custody operation. The console does not receive, decrypt, export or handle signing material.

## Emergency flow

`SUPER_ADMIN + fresh step-up authentication -> FREEZE -> REQUEST_SWEEP -> isolated custody service -> execution -> final verification`

The emergency destination registry is per asset and supports only BTC/XMR. A sweep request must contain exactly one validated destination for each supported asset.

## Intentionally pending

Actual blockchain transaction signing/broadcast remains behind `server/custody/` and must only be connected through its authenticated internal boundary. This change does **not** implement an unrestricted fund-transfer endpoint, does not expose keys, and does not bypass custody policy.

The following remain required before production sign-off:

1. Persisted panic API wired to the migration.
2. Fresh WebAuthn/TOTP step-up specifically for emergency actions.
3. Authenticated custody RPC with replay protection and strict operation allowlisting.
4. Real BTC/XMR emergency destination validation and operational verification.
5. End-to-end tests using isolated test wallets/nodes.
6. Immutable audit-chain insertion and verification implementation.
