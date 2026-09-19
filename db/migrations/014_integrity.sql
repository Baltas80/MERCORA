CREATE OR REPLACE FUNCTION prevent_ledger_transaction_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ledger_append_only'; END $$;
DROP TRIGGER IF EXISTS ledger_transactions_immutable ON ledger_transactions;
CREATE TRIGGER ledger_transactions_immutable BEFORE UPDATE OR DELETE ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION prevent_ledger_transaction_mutation();

ALTER TABLE dispute_messages DROP CONSTRAINT IF EXISTS dispute_messages_author_shape;
ALTER TABLE dispute_messages ADD CONSTRAINT dispute_messages_author_shape CHECK(author_account_id IS NOT NULL OR author_role='system');

ALTER TABLE promo_codes DROP CONSTRAINT IF EXISTS promo_benefit_shape;
ALTER TABLE promo_codes ADD CONSTRAINT promo_benefit_shape CHECK(
  (benefit_type='free_store' AND benefit_asset_code IS NULL AND benefit_atomic IS NULL AND benefit_percent IS NULL)
  OR (benefit_type='fee_discount_fixed' AND benefit_asset_code IS NOT NULL AND benefit_atomic>0 AND benefit_percent IS NULL)
  OR (benefit_type='fee_discount_percent' AND benefit_asset_code IS NULL AND benefit_atomic IS NULL AND benefit_percent BETWEEN 1 AND 100)
);
