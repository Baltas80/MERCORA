# MERCORA seller stores

## Business model

Opening a seller store is normally a paid action. The activation fee is configurable per supported payment asset in \`seller_fee_rules\`.

A promotion code can waive the fee entirely or apply a controlled discount.

A promotion code does not bypass moderation, seller eligibility, prohibited-product rules, account controls or dispute procedures.

## Activation lifecycle

\`\`\`
Account
  -> seller store request
  -> fee snapshot / promotion evaluation
  -> payment verification OR committed promotion redemption
  -> seller store activation
\`\`\`

A client request never activates a store directly.

For paid activation, the payment subsystem must establish the authoritative \`verified\` state.

For promotion redemption, the database transaction must lock the code row, verify validity/usage, create the redemption and increment \`used_count\` atomically.

## Promotion codes

Codes are generated with high entropy and only the SHA-256 digest is persisted.

Supported benefits:
- \`free_store\`
- \`fee_discount_fixed\`
- \`fee_discount_percent\`

Each code has a usage limit, validity window and revocation state.

Recommended operational practice: use at least 128 bits of entropy and never write plaintext codes to application logs.

## Security invariants

1. One account cannot hold multiple active seller-store activations.
2. Paid activation requires independently verified payment.
3. Free activation requires an actually committed redemption.
4. Promotion usage cannot exceed \`max_uses\`.
5. Activation must be idempotent and transactional.
6. Store activation and moderation remain separate.
7. Code possession never grants administrative privileges.

## Financial integration

When the audited payment-intent branch is merged, \`payment_reference\` should point to the canonical server-side payment intent. A client-provided value must never be treated as payment proof.
