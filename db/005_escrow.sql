-- MERCORA escrow policy and authorization domain.
-- Financial settlement must be executed by the isolated ledger/custody service.
-- The admin console can configure policy and authorize actions but cannot edit balances.

ALTER TABLE system_state
  ADD CONSTRAINT system_state_custody_mode_values
  CHECK (key <> 'custody_mode' OR value IN ('normal','frozen'));

CREATE TABLE IF NOT EXISTS escrow_policies (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id=1),
  escrow_enabled BOOLEAN NOT NULL DEFAULT true,
  mid_escrow_enabled BOOLEAN NOT NULL DEFAULT false,
  mid_release_bps INTEGER NOT NULL DEFAULT 5000 CHECK (mid_release_bps BETWEEN 1 AND 9999),
  early_pay_enabled BOOLEAN NOT NULL DEFAULT false,
  early_pay_delay_hours INTEGER NOT NULL DEFAULT 24 CHECK (early_pay_delay_hours BETWEEN 0 AND 8760),
  early_pay_max_bps INTEGER NOT NULL DEFAULT 8000 CHECK (early_pay_max_bps BETWEEN 1 AND 9999),
  dispute_window_hours INTEGER NOT NULL DEFAULT 48 CHECK (dispute_window_hours BETWEEN 0 AND 8760),
  auto_release_hours INTEGER NOT NULL DEFAULT 72 CHECK (auto_release_hours BETWEEN 0 AND 8760),
  new_seller_escrow_required BOOLEAN NOT NULL DEFAULT true,
  new_seller_hold_hours INTEGER NOT NULL DEFAULT 168 CHECK (new_seller_hold_hours BETWEEN 0 AND 8760),
  high_value_review_enabled BOOLEAN NOT NULL DEFAULT true,
  high_value_threshold_atomic NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (high_value_threshold_atomic >= 0),
  manual_release_required BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL DEFAULT 'migration'
);

INSERT INTO escrow_policies(id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS order_escrows (
  order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  asset_code TEXT NOT NULL REFERENCES assets(code),
  escrowed_atomic NUMERIC(78,0) NOT NULL CHECK (escrowed_atomic > 0),
  released_atomic NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (released_atomic >= 0),
  refunded_atomic NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (refunded_atomic >= 0),
  state TEXT NOT NULL DEFAULT 'held'
    CHECK (state IN (
      'pending','held','mid_release_authorized','early_pay_authorized',
      'release_authorized','refund_authorized','disputed','frozen','completed'
    )),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  release_available_at TIMESTAMPTZ,
  dispute_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (released_atomic + refunded_atomic <= escrowed_atomic)
);

CREATE INDEX IF NOT EXISTS idx_order_escrows_state_updated
  ON order_escrows(state, updated_at DESC);

CREATE TABLE IF NOT EXISTS escrow_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'mid_release','early_pay','release','refund','freeze','unfreeze'
  )),
  amount_atomic NUMERIC(78,0),
  actor TEXT NOT NULL,
  reason TEXT,
  state TEXT NOT NULL DEFAULT 'authorized'
    CHECK (state IN ('authorized','executed','rejected','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ,
  CHECK (amount_atomic IS NULL OR amount_atomic > 0)
);

CREATE INDEX IF NOT EXISTS idx_escrow_authorizations_order_created
  ON escrow_authorizations(order_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_one_active_terminal_authorization
  ON escrow_authorizations(order_id, action)
  WHERE state='authorized' AND action IN ('release','refund');

CREATE TABLE IF NOT EXISTS escrow_audit_events (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escrow_audit_events_created
  ON escrow_audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_escrow_audit_events_order
  ON escrow_audit_events(order_id, created_at DESC);
