# MERCORA admin console and seller risk

## Administrator scope

The admin console is the operational control plane for:
- users and sessions;
- seller accounts and stores;
- listings and moderation;
- orders and sales;
- payment-intent status and reconciliation;
- custody-account metadata;
- escrow state;
- seller points and levels;
- payout-mode requests and payouts;
- promotion codes;
- administrative audit;
- emergency controls.

The console must use role-based permissions. A super administrator has broad visibility, but high-risk financial actions still require step-up authentication and an independent second approval.

## Financial control boundary

Administrators must never edit ledger balances directly.

Wallet private keys, seeds and signing material are outside the admin application trust boundary. The console can inspect wallet/custody metadata and request guarded operations from the financial service.

Escrow releases, refunds, withdrawals, payout approvals and emergency recovery remain state-machine operations and must be fully audited.

## Seller points and levels

Points are append-only ledger events with idempotency keys. A point balance is derived from the ledger.

Default level policy is configurable:
- Nuevo: 0 points
- Establecido: 100 points + 5 completed sales
- Confiable: 500 points + 20 completed sales
- Avanzado: 1500 points + 50 completed sales
- Preferente: 3000 points + 100 completed sales

Levels also include dispute-rate gates and payout-mode permissions.

Points alone never guarantee a payout mode. A seller must remain active, satisfy the current risk gates and, for higher-risk modes, obtain administrative approval.

## Payout modes

- standard_escrow: normal protected settlement.
- early_release: limited early release after eligibility and explicit approval.
- advance_payout: seller may request payment before the normal protection point, subject to higher level, current risk state and explicit approval.

A later downgrade, suspension, open dispute or policy change must be able to suspend an already-approved payout mode for future payouts.

## Privacy

The admin console should expose only the minimum data required for the administrator's role. It must not expose private keys, seeds or unnecessary identity metadata.