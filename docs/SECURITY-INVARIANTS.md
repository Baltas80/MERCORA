# MERCORA Security Invariants

These are implementation gates, not marketing claims.

- No secret, seed, private key or signing credential is stored in Git.
- No frontend code can access custody signing material.
- No API request can directly mutate a user balance.
- Every balance change is an immutable ledger transaction.
- Ledger transactions are idempotent and double-entry balanced.
- Withdrawals require explicit authorization and state transitions.
- Emergency freeze is fail-closed for withdrawals and settlement.
- Blockchain callbacks are authenticated, validated and idempotent.
- Database and blockchain state are periodically reconciled.
- Administrative actions are authenticated, authorized and audited.
- Internal services use least privilege and explicit network boundaries.
- Production configuration is separate from development configuration.
- A failed security check blocks deployment rather than being ignored.

## Definition of done for custody

Custody is not production-ready until these invariants have automated coverage, recovery procedures have been tested, and the wallet/signing boundary has undergone security review.
