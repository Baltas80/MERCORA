CREATE TABLE IF NOT EXISTS payment_allocations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),payment_intent_id UUID NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,seller_account_id UUID NOT NULL REFERENCES sellers(account_id),asset_code CHAR(3) NOT NULL CHECK(asset_code IN('BTC','LTC','XMR')),amount_atomic NUMERIC(78,0) NOT NULL CHECK(amount_atomic>0),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(payment_intent_id,seller_account_id));
ALTER TABLE seller_escrows ADD COLUMN IF NOT EXISTS asset_code CHAR(3);
ALTER TABLE seller_escrows ADD COLUMN IF NOT EXISTS amount_atomic NUMERIC(78,0);
ALTER TABLE escrow_ledger_entries ADD COLUMN IF NOT EXISTS asset_code CHAR(3);
ALTER TABLE escrow_ledger_entries ADD COLUMN IF NOT EXISTS amount_atomic NUMERIC(78,0);
CREATE INDEX IF NOT EXISTS payment_allocations_intent_idx ON payment_allocations(payment_intent_id,seller_account_id);
