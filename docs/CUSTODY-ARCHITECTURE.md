# MERCORA Custody Architecture

## Status
Design baseline. No production funds or private keys belong in this repository.

## Objectives

MERCORA may provide custodial balances for supported digital assets. The marketplace account, internal ledger, blockchain custody layer, and emergency controls are separate trust domains.

### Core invariants

1. Every balance belongs to exactly one internal account and one asset.
2. Balances are derived from an append-only double-entry ledger; administrators cannot edit balances directly.
3. Blockchain movements are represented by immutable ledger events and reconciled against chain state.
4. Private keys never enter the application database, frontend, source control, or logs.
5. A compromised marketplace/API process must not automatically obtain signing authority.
6. Emergency mode freezes risk-increasing operations before any recovery transfer is authorized.
7. Emergency custody uses one destination wallet per blockchain/asset, not one cross-chain wallet.
8. Emergency procedures preserve the complete user-to-asset-to-amount accounting record.

## Logical model

```text
User account
   |
   +-- BTC sub-ledger
   +-- XMR sub-ledger
   +-- LTC sub-ledger

Ledger <----> Blockchain adapters <----> Isolated node/wallet services
   |
   +---- Reconciliation
   +---- Audit events
   +---- Emergency state
```

## Ledger

Use integer atomic units, never floating point amounts. Each transaction must balance debits and credits. Ledger entries are immutable; corrections are compensating entries.

Recommended entities:

- `accounts`
- `assets`
- `ledger_transactions`
- `ledger_entries`
- `blockchain_transactions`
- `deposit_addresses`
- `withdrawal_requests`
- `reconciliation_runs`
- `emergency_events`

Every external transaction should carry a stable idempotency key and chain/network identifier.

## Wallet separation

The web/API tier can request a payment operation but must not possess private signing material. Wallet/node services run in a separate trust boundary with narrowly scoped interfaces. Production signing keys should be held by dedicated key-management infrastructure and protected with independent authorization.

Hot-wallet exposure should be limited. Reserve/cold custody should be separated from routine transaction processing.

## Emergency mode

Emergency mode is a state machine, not a database flag that silently changes balances.

```text
NORMAL
  |
  v
FREEZE_REQUESTED
  |
  v
FROZEN
  |
  v
RECOVERY_AUTHORIZED
  |
  v
RECOVERY_EXECUTING
  |
  v
RECOVERED / RECONCILIATION_REQUIRED
```

On freeze:

- stop new deposits from being credited;
- stop withdrawals and irreversible account changes;
- stop marketplace settlement that would increase custody exposure;
- preserve ledger and security audit events;
- snapshot operational state;
- require independent authorization for recovery transfers.

Recovery is executed separately for BTC, XMR and LTC. Afterward, reconciliation must prove that blockchain-controlled assets and the internal ledger agree, with any discrepancy blocking normal operation.

## Audit requirements

Record security-relevant events without collecting unnecessary user metadata. Emergency actions require actor identity, authorization evidence, timestamp, affected asset, transaction identifier and result. Audit records must be tamper-evident and access-controlled.

## Failure assumptions

Design and test for:

- database corruption;
- stale blockchain state;
- duplicate callbacks;
- node compromise;
- wallet service compromise;
- replayed withdrawal requests;
- partial recovery;
- network partition;
- inconsistent ledger/blockchain state;
- lost application availability.

No production deployment should activate custody until automated tests and an independent security review validate these invariants.
