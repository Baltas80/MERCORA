CREATE TABLE IF NOT EXISTS payment_fee_allocations(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id UUID NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  asset_code CHAR(3) NOT NULL CHECK(asset_code IN('BTC','LTC','XMR')),
  kind TEXT NOT NULL CHECK(kind IN('buyer_fee','blockchain_fee','adjustment')),
  amount_atomic NUMERIC(78,0) NOT NULL CHECK(amount_atomic>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(payment_intent_id,kind)
);
CREATE INDEX IF NOT EXISTS payment_fee_allocations_intent_idx ON payment_fee_allocations(payment_intent_id,kind);
