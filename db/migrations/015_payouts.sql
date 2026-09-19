CREATE TABLE IF NOT EXISTS seller_payout_requests(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id UUID NOT NULL REFERENCES sellers(account_id),
  order_id UUID REFERENCES orders(id),
  asset_code CHAR(3) NOT NULL CHECK(asset_code IN('BTC','LTC','XMR')),
  amount_atomic NUMERIC(78,0) NOT NULL CHECK(amount_atomic>0),
  mode TEXT NOT NULL REFERENCES seller_payout_policies(mode),
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN('requested','risk_review','approved','processing','paid','rejected','cancelled','blocked')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seller_payout_requests_queue_idx ON seller_payout_requests(status,created_at);
