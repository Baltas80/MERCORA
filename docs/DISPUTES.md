# MERCORA dispute resolution

## Workflow

`OPEN -> AWAITING_* -> UNDER_REVIEW -> MEDIATION -> DECIDED -> RESOLVED`

Either buyer or seller can open a dispute for an eligible order. The case stores the parties, reason, deadlines, evidence, messages, events and decision.

## Evidence

Evidence is referenced by an isolated object-storage key and SHA-256 digest. Original filenames must not be trusted as storage paths. Uploaded files must never be executed.

## Decision model

Supported outcomes:
- `buyer_refund`
- `seller_release`
- `partial_settlement`
- `no_change`
- `reject`

Financial outcomes are decisions, not direct wallet operations. The guarded payment/escrow service must validate current escrow state, available funds, authorization and idempotency before execution.

## Appeal

After `decided`, either party may open one appeal. Appeals are assigned to a reviewer who did not make the original decision when separation of duties is available.

## Anti-abuse

Opening disputes is rate-limited per account/order. Only one active dispute exists per order. Repeated frivolous or abusive disputes can affect seller/buyer risk policy, but enforcement decisions are recorded and auditable.

## Privacy

Dispute evidence and messages should contain the minimum data required. Evidence metadata must be minimized and access-controlled. The system should not expose private keys, wallet signing material or unrelated account data to either party.

## Emergency/failure behavior

If the financial service cannot execute a decision, the dispute remains financially pending/blocked rather than silently changing balances. Reconciliation is required before retrying a failed financial outcome.