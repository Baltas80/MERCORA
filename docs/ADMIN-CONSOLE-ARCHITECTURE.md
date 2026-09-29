# MERCORA Admin Console Architecture

## Scope

The Admin Console is a local administrative control plane for the single-store MERCORA marketplace over Tor/Onion Service.

Trust path:

Admin UI -> Tauri endpoint allowlist -> localhost Admin Control API -> authenticated policy boundary -> fixed backend/custody operations.

The console never receives or stores wallet private keys, seeds, mnemonics, wallet credentials or HSM/signing material.

## Eight tabs

| Tab | Purpose | Backend surface |
|---|---|---|
| Dashboard | KPIs, operational health, critical alerts | /v1/console/overview, /v1/console/status |
| Custody & Funds | BTC/XMR balances and hot/cold/emergency registry | /v1/console/custody |
| Product Catalog | listings, price, categories, inventory model | /v1/console/catalog |
| Orders | order lifecycle and refund boundary | /v1/console/orders |
| Customers & CRM | accounts, membership, risk and tickets | /v1/console/customers |
| Store Builder | public content and campaign metadata | /v1/console/store |
| Infrastructure & Tor | Node.js, PostgreSQL, Tor, Onion Service and storage | /v1/console/infrastructure |
| Settings & Emergency | RBAC, audit integrity and Panic Mode | /v1/console/security, /v1/emergency/* |

## Emergency control

The current owner role is the Better Auth admin role. Critical emergency operations require a fresh TOTP 2FA step-up.

State machine:

normal -> frozen -> sweep_prepared -> sweeping -> completed

A failed emergency execution moves the platform to recovery_required.

Freeze records platform_mode=frozen and custody_mode=frozen in PostgreSQL and emits an audit event.

Sweep planning covers all positive observed hot-wallet balances for BTC/XMR and selects only same-asset emergency destinations. Cold wallets are excluded.

The repository deliberately fails closed when the isolated custody signer/RPC is unavailable. The Admin Console cannot sign, export credentials or directly transfer funds.

## Secret isolation

Runtime wallet data belongs outside the repository in:

<secure-data-root>/users/<username>/wallet-vault/

The vault is encrypted at rest. Recovery is a separate privileged procedure; the desktop Admin Console never receives plaintext wallet secrets.

## Audit integrity

Critical admin events use a chained SHA-256 integrity record. The chain is tamper-evident and uses a database transaction lock to prevent concurrent forks.

This is integrity hashing, not a digital signature. A future external audit signer can sign the row digest without placing any signing key in PostgreSQL or the Admin Console.

## Security invariants

- localhost-only Admin Control API;
- no arbitrary shell or SQL endpoint;
- fixed Tauri endpoint allowlist;
- Better Auth session authentication;
- TOTP 2FA step-up for emergency operations;
- fail-closed isolated custody boundary;
- BTC/XMR only;
- hot/cold/emergency separation;
- no secrets in UI responses or logs;
- audit event for each critical transition;
- no direct balance mutation path.
