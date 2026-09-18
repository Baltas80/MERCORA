# MERCORA payment architecture

## Principles

Payment processing is isolated behind adapters. The marketplace domain never trusts the browser to establish payment status or settlement.

Supported adapter targets:

- Bitcoin.
- Litecoin.
- Monero.
- Lightning.

A future payment method must implement the same server-side contract without exposing private keys or node credentials to the frontend.

## Payment lifecycle

CREATED -> AWAITING_PAYMENT -> DETECTED -> CONFIRMING -> CONFIRMED

Exceptional states are:

- FAILED.
- EXPIRED.
- CANCELLED.
- REFUNDED.

The service must reject invalid state transitions.

## Verification

A payment is not considered confirmed because a transaction ID was submitted by a user.

The adapter must obtain payment state from its authoritative server-side node/service and apply the required confirmation policy before settlement.

## Fees

Platform commissions are independent from blockchain/network fees.

MERCORA has two separate platform charges:

- buyer commission, added to the buyer amount;
- seller commission, deducted from seller settlement.

The applicable percentages are represented as versioned basis-point policies and are snapshotted into the order.

Actual production commission rates remain a product/legal decision and are intentionally not hard-coded.

## Custody boundary

Private keys, wallet seeds, node credentials and signing material must remain outside the application repository and frontend.

A payment adapter may be:

- self-hosted;
- non-custodial where operationally viable;
- or isolated behind a hardened payment service.

The application receives only the minimum information needed to create and verify payment intents.

## Recovery and reconciliation

Every balance-affecting payment transition must be:

- idempotent;
- auditable;
- replay-safe;
- recoverable after restart;
- reconciliable against authoritative node state.

Emergency freeze must fail closed: when payment state is uncertain, settlement remains blocked.

## Privacy

Payment metadata is separated from the account model wherever possible. Retention is limited to what is required for reconciliation, dispute handling, security and applicable legal obligations.

No mechanism is designed to conceal illicit activity or circumvent lawful controls.
