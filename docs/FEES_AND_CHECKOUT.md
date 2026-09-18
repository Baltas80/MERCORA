# MERCORA fees and checkout integrity

## Fee model

MERCORA supports two independent platform commission rates:

- Buyer commission.
- Seller commission.

The rates are represented as integer basis points (bps), where 100 bps = 1%.

No fee percentage is hard-coded into application logic. A versioned fee policy is stored separately so historical orders retain the exact policy that was applied at checkout.

For each order, the system must persist:

- fee policy version;
- buyer fee amount;
- seller fee amount;
- subtotal;
- buyer total;
- seller net amount.

The buyer commission is added to the amount charged to the buyer. The seller commission is deducted from the seller's settlement amount. These are economically distinct charges and must remain separately visible and auditable.

Seller commission is calculated from each order line before aggregation. Buyer commission is calculated from the order subtotal.

Fee amounts are calculated server-side in integer minor currency units. Floating-point arithmetic is prohibited for monetary calculations.

## Seller escrow

New sellers are protected by a separate seller-escrow policy.

For a seller who has not yet reached the policy's successful-order threshold:

- payment must still be server-verified normally;
- the seller net settlement is held in escrow;
- release is blocked until delivery/settlement conditions and the escrow delay are satisfied;
- a dispute freezes the escrow;
- release/refund is idempotent and auditable.

The escrow policy is versioned separately from the platform fee policy. Changing either policy must not rewrite historical orders.

The escrow model is documented in docs/ESCROW.md.

## Important product decision

The actual buyer and seller commission percentages are not set yet. They must be approved before production payment activation and then captured by policy version.

Changing a future commission must never rewrite the economics of an existing order.

## Checkout invariants

1. Inventory reservation and order creation occur inside a database transaction.
2. Inventory rows are locked before availability is committed.
3. The client never supplies the authoritative fee amount.
4. The client never supplies the authoritative order total.
5. The server calculates all monetary amounts.
6. Payment confirmation comes from the payment adapter/node, never from browser input.
7. A retry of the same checkout request must be idempotent.
8. Failed or expired payment intents release reservations according to an explicit state transition.
9. Settlement cannot proceed against an order whose payment state is unverified.
10. Seller fee accounting and buyer fee accounting remain separate ledger entries.
11. For new sellers, server-verified payment confirmation and seller escrow creation occur atomically.
12. A seller payout cannot bypass an applicable escrow row.

## Concurrency threat model

Two concurrent buyers attempting to reserve the final unit must not both succeed.

The intended transaction uses row-level locking with SELECT ... FOR UPDATE and only decrements available inventory after the locked row is verified.

When multiple listings are reserved in one order, the service should lock them in deterministic order to reduce deadlock risk.

## Inventory authority

After migration 004, listing_inventory is the authoritative inventory state. The legacy listings.quantity column exists only as a migration seed value and must not be used by checkout logic.

## Privacy

The order model does not require client IP or user-agent fields. Payment and escrow metadata must be kept separate from the buyer account model and limited to what reconciliation, dispute handling, security and applicable legal obligations require.
