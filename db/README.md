# Database

`schema.sql` defines the initial PostgreSQL model for MERCORA accounts, assets, immutable ledger entries, blockchain observations, withdrawals and emergency state.

Balances are derived from ledger entries. Application code must perform balanced double-entry writes in a single database transaction and use idempotency keys for external events.

This schema contains no wallet keys or production credentials.
