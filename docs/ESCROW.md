# MERCORA seller escrow

## Purpose

New sellers do not immediately receive the seller settlement from funded orders. MERCORA places the seller net amount into an escrow hold until the release conditions are satisfied or a dispute/refund resolves the order.

Escrow is a settlement control. It is separate from:

- the buyer platform commission;
- the seller platform commission;
- blockchain/network fees;
- the payment confirmation state.

## Initial policy

The first policy version is intentionally data-driven:

- the first 5 successfully completed orders require escrow;
- after an order is delivered, funds remain held for 72 hours before they become release-eligible;
- an escrow policy is versioned, so changing the policy does not rewrite historical orders.

The numbers are initial operational defaults, not application constants. A later policy can change the threshold or delay.

## Lifecycle

The intended lifecycle is:

HELD -> RELEASED

or, when a dispute is opened:

HELD -> DISPUTED -> RELEASED

or:

HELD -> DISPUTED -> REFUNDED

A direct release from a disputed escrow is only permitted through the dispute-resolution path. Terminal states cannot be reopened.

## Amount held

The escrow amount is the seller's net settlement:

seller gross line amounts - seller commission

The buyer commission is not put into seller escrow. It is accounted for separately as MERCORA platform revenue.

All calculations use integer minor units; floating-point arithmetic is not permitted.

## Funding boundary

An escrow must never be considered funded merely because a buyer submitted a transaction identifier.

The production flow must be:

1. create the order;
2. create and track its payment intent;
3. obtain server-side confirmation from the payment adapter/node;
4. atomically mark the order as funded/confirmed and create the seller escrow holds required by the seller policy;
5. prevent seller payout while an applicable escrow is held.

The escrow creation and the payment-confirmed state transition must execute in one database transaction.

## New-seller evaluation

Seller trust is based on completed marketplace orders, not on client-supplied flags.

The database exposes seller_completed_order_counts, derived from completed order items. At funding time, the service loads the active escrow policy and evaluates each seller independently.

For a multi-seller order, one order can therefore create multiple escrow rows, one per seller requiring escrow.

The policy version is copied to each escrow row so later policy changes cannot affect an already-funded order.

## Release

An escrow becomes release-eligible only after:

- the order is in a delivered/settled state recognized by the order service;
- no active dispute blocks settlement;
- the policy hold period has elapsed.

Release must be idempotent. A repeated worker/job execution must not create a second release ledger entry.

The escrow_ledger_entries table uses a unique (escrow_id, entry_type) key to enforce this property at the database boundary.

## Disputes and refunds

Opening a dispute moves the escrow to disputed and blocks automatic release.

A resolved dispute can authorize either:

- release to the seller; or
- refund of the held seller settlement as part of the order's refund workflow.

The order/payment refund flow must remain authoritative for returning buyer funds. Escrow only governs the seller settlement side.

## Security invariants

- The browser never decides whether escrow is required.
- The browser never supplies the escrow amount.
- Seller identity is resolved from authoritative order data.
- Escrow policy selection is server-side and versioned.
- Release/refund operations are idempotent.
- Escrow is fail-closed while payment or dispute state is uncertain.
- Seller escrow rows never store private keys, wallet seeds or signing material.
- Escrow events and ledger entries are auditable.
- No IP address or user-agent data is required by the escrow model.

## Production work remaining

This migration and domain module establish the escrow foundation. The full checkout/order service still needs to atomically create these rows after server-verified payment confirmation, and the production payout service must consume released escrow entries exactly once.

Before production, the release worker, dispute UI/moderation workflow, seller balance ledger and payout adapters must be integrated and covered by integration/concurrency tests.
