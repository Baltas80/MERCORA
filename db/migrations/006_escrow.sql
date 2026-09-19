CREATE TABLE IF NOT EXISTS escrow_policies(
  version INTEGER PRIMARY KEY,
  successful_orders_required INTEGER NOT NULL CHECK(successful_orders_required>=0),
  hold_after_delivery_seconds BIGINT NOT NULL CHECK(hold_after_delivery_seconds>0),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS escrow_policies_single_active_idx ON escrow_policies(active) WHERE active;
INSERT INTO escrow_policies(version,successful_orders_required,hold_after_delivery_seconds,active)
VALUES(1,5,259200,TRUE) ON CONFLICT(version) DO NOTHING;

CREATE TABLE IF NOT EXISTS seller_escrows(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  seller_id UUID NOT NULL REFERENCES sellers(account_id),
  currency CHAR(3) NOT NULL,
  amount_minor BIGINT NOT NULL CHECK(amount_minor>=0),
  policy_version INTEGER NOT NULL REFERENCES escrow_policies(version),
  status TEXT NOT NULL DEFAULT 'held' CHECK(status IN('held','disputed','released','refunded')),
  release_eligible_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id,seller_id)
);
CREATE INDEX IF NOT EXISTS seller_escrows_seller_status_idx ON seller_escrows(seller_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS seller_escrows_release_idx ON seller_escrows(release_eligible_at) WHERE status='held' AND release_eligible_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS escrow_ledger_entries(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id UUID NOT NULL REFERENCES seller_escrows(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  seller_id UUID NOT NULL REFERENCES sellers(account_id),
  currency CHAR(3) NOT NULL,
  entry_type TEXT NOT NULL CHECK(entry_type IN('hold','release','refund')),
  amount_minor BIGINT NOT NULL CHECK(amount_minor>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(escrow_id,entry_type)
);
