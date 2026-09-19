ALTER TABLE ledger_accounts
  DROP CONSTRAINT IF EXISTS ledger_accounts_account_type_check;

ALTER TABLE ledger_accounts
  ADD CONSTRAINT ledger_accounts_account_type_check
  CHECK(account_type IN(
    'customer_liability','escrow','platform_revenue','blockchain_fee',
    'treasury','unallocated','withdrawal_hold','payout_hold'
  ));

ALTER TABLE admin_mfa_credentials
  ADD COLUMN IF NOT EXISTS last_timestep BIGINT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
