# MERCORA financial operations

## Boundary

The application manages orders, payment intents, escrow state, internal accounting and guarded requests. It does not hold signing keys.

## Fees

Buyer and seller fees are calculated from a versioned policy. The applied policy version and amounts are stored with the order so historical orders do not change when policy changes.

## Withdrawals

A withdrawal request first reserves the user's internal liability through an append-only ledger transaction. Approval and signing are separate stages. A withdrawal is not considered paid until the isolated financial service reports a verified result.

## Payouts

Seller payout modes are controlled by current seller status, points, completed sales, dispute rate and active policy. A payout request is only a request; external signing is a separate trust boundary.

## Reconciliation

On-chain observations must be compared to the internal accounting model. Any mismatch enters financial freeze mode. Normal operation may resume only after the required asset reconciliations are matched and the emergency workflow is authorized.

## No-production-funds rule

No real wallet keys or production funds should be connected until blockchain adapters, signing isolation, reconciliation, backup recovery, concurrency testing, incident procedures and independent security/legal review are complete.
