# MERCORA Emergency Runbook

## Trigger

Emergency mode is for suspected compromise, wallet-key exposure, critical application compromise, database integrity failure, or another condition where continued balance-affecting operations are unsafe.

## Immediate sequence

1. Set global state to `FROZEN`.
2. Reject new deposits at the application layer.
3. Reject withdrawals and transfers.
4. Stop marketplace operations that change custody balances.
5. Preserve security/audit events.
6. Snapshot relevant state using approved incident procedures.
7. Require independent authorization before treasury movement.
8. Move funds only through the asset-specific recovery procedure.
9. Reconcile on-chain holdings against the internal ledger.
10. Keep the platform frozen until reconciliation and security review pass.

## Invariants

- Never delete or rewrite historical ledger entries to make balances match.
- Never expose private keys to application logs, CI, source control or support tooling.
- Never reuse a destination across different assets.
- Never claim recovery succeeded until on-chain confirmation and ledger reconciliation agree.

## Recovery result

For every affected account, retain the internal mapping of account ID, asset, balance, source events and resulting recovery allocation. User accounting must remain reconstructable after consolidation.
