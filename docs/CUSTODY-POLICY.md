# MERCORA Custody Policy

The custody policy is a runtime authorization boundary for withdrawals.

## Fail-closed rules

A withdrawal is denied unless:

- custody mode is `normal`;
- the asset is explicitly enabled;
- the network is explicitly enabled;
- the amount is an integer atomic-unit value;
- sufficient available custody balance is supplied by the authoritative ledger;
- the per-withdrawal limit is configured and not exceeded;
- the daily limit is configured and not exceeded.

An additional-approval boundary is also configured per asset. Crossing it does not itself authorize a withdrawal; it marks the operation as requiring the independent approval workflow.

## Configuration

Production configuration must supply, per supported asset:

- `maxPerWithdrawalAtomic`;
- `maxDailyAtomic`;
- `approvalThresholdAtomic`.

No monetary defaults are embedded in application code. Limits are deployment policy and must be reviewed before production use.

## Security boundary

The policy validates whether an operation is eligible to enter the withdrawal workflow. It does not sign transactions, mutate balances, or bypass the ledger.

The sequence is:

`authenticated request -> policy -> ledger reservation/authorization -> isolated wallet service -> reconciliation`

A policy rejection must not create a balance-affecting ledger entry or a signing request.

## Privacy

Policy evaluation does not require storing destination secrets, private keys, seeds or wallet credentials. Logs should contain the decision and an opaque operation identifier, not sensitive transaction material.
