-- MERCORA seller-store activation and promotional-code domain.
-- Financial verification remains owned by the payment subsystem.

ALTER TABLE seller_profiles
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','suspended','closed')),
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS seller_fee_rules (
  asset_code TEXT PRIMARY KEY REFERENCES assets(code),
  fee_atomic NUMERIC(78,0) NOT NULL CHECK (fee_atomic > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seller_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id),
  store_name TEXT NOT NULL CHECK (length(store_name) BETWEEN 2 AND 80),
  store_slug TEXT NOT NULL UNIQUE CHECK (store_slug ~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','suspended','closed')),
  activation_source TEXT NOT NULL DEFAULT 'paid'
    CHECK (activation_source IN ('paid','promo')),
  activation_code_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seller_store_activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  requested_store_name TEXT NOT NULL CHECK (length(requested_store_name) BETWEEN 2 AND 80),
  requested_store_slug TEXT NOT NULL CHECK (requested_store_slug ~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$'),
  source TEXT NOT NULL DEFAULT 'paid'
    CHECK (source IN ('paid','promo')),
  fee_asset_code TEXT REFERENCES assets(code),
  fee_snapshot_atomic NUMERIC(78,0) CHECK (fee_snapshot_atomic IS NULL OR fee_snapshot_atomic > 0),
  payment_reference TEXT,
  payment_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (payment_status IN ('not_required','pending','verified','rejected')),
  promo_code_id UUID,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','activated','rejected','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_seller_store_activation
  ON seller_store_activations(account_id)
  WHERE status IN ('pending','approved','activated');

CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL UNIQUE,
  benefit_type TEXT NOT NULL
    CHECK (benefit_type IN ('free_store','fee_discount_fixed','fee_discount_percent')),
  benefit_asset_code TEXT REFERENCES assets(code),
  benefit_atomic NUMERIC(78,0) CHECK (benefit_atomic IS NULL OR benefit_atomic > 0),
  benefit_percent SMALLINT CHECK (benefit_percent IS NULL OR benefit_percent BETWEEN 1 AND 100),
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= max_uses),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','revoked','expired','exhausted')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (benefit_type = 'free_store' AND benefit_asset_code IS NULL AND benefit_atomic IS NULL AND benefit_percent IS NULL)
    OR
    (benefit_type = 'fee_discount_fixed' AND benefit_asset_code IS NOT NULL AND benefit_atomic IS NOT NULL AND benefit_percent IS NULL)
    OR
    (benefit_type = 'fee_discount_percent' AND benefit_asset_code IS NULL AND benefit_atomic IS NULL AND benefit_percent IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS promo_code_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id UUID NOT NULL REFERENCES promo_codes(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  activation_id UUID REFERENCES seller_store_activations(id),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(promo_code_id, account_id),
  UNIQUE(activation_id)
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_status
  ON promo_codes(status, valid_from, expires_at);

CREATE INDEX IF NOT EXISTS idx_seller_stores_status
  ON seller_stores(status);

CREATE INDEX IF NOT EXISTS idx_seller_store_activations_account
  ON seller_store_activations(account_id, status);

-- Redemption must lock the promotion row and increment used_count atomically.
