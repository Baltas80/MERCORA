ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS ledger_accounts_account_type_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_account_type_check
CHECK(account_type IN('customer_liability','escrow','platform_revenue','blockchain_fee','treasury','unallocated','withdrawal_hold'));

CREATE INDEX IF NOT EXISTS withdrawal_requests_account_state_idx ON withdrawal_requests(account_id,state,created_at DESC);
CREATE INDEX IF NOT EXISTS payment_intents_account_state_idx ON payment_intents(account_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS reconciliation_runs_asset_time_idx ON reconciliation_runs(asset_code,finished_at DESC);
