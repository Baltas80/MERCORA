ALTER TABLE sellers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
ALTER TABLE sellers ADD CONSTRAINT sellers_status_check CHECK(status IN('pending','active','suspended','closed')) NOT VALID;

CREATE TABLE IF NOT EXISTS seller_fee_rules(
  asset_code CHAR(3) PRIMARY KEY CHECK(asset_code IN('BTC','LTC','XMR')),
  fee_atomic NUMERIC(78,0) NOT NULL CHECK(fee_atomic>0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS promo_codes(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash BYTEA NOT NULL UNIQUE,
  benefit_type TEXT NOT NULL CHECK(benefit_type IN('free_store','fee_discount_fixed','fee_discount_percent')),
  benefit_asset_code CHAR(3) CHECK(benefit_asset_code IN('BTC','LTC','XMR')),
  benefit_atomic NUMERIC(78,0),
  benefit_percent SMALLINT CHECK(benefit_percent IS NULL OR benefit_percent BETWEEN 1 AND 100),
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK(max_uses>0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count BETWEEN 0 AND max_uses),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','revoked','expired','exhausted')),
  created_by UUID NOT NULL REFERENCES accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seller_stores(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id),
  store_name TEXT NOT NULL CHECK(char_length(store_name) BETWEEN 2 AND 80),
  store_slug TEXT NOT NULL UNIQUE CHECK(store_slug ~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','active','suspended','closed')),
  activation_source TEXT NOT NULL DEFAULT 'paid' CHECK(activation_source IN('paid','promo')),
  activation_code_id UUID REFERENCES promo_codes(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS seller_store_activations(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  requested_store_name TEXT NOT NULL CHECK(char_length(requested_store_name) BETWEEN 2 AND 80),
  requested_store_slug TEXT NOT NULL CHECK(requested_store_slug ~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$'),
  source TEXT NOT NULL CHECK(source IN('paid','promo')),
  fee_asset_code CHAR(3) CHECK(fee_asset_code IN('BTC','LTC','XMR')),
  fee_snapshot_atomic NUMERIC(78,0),
  payment_intent_id UUID REFERENCES payment_intents(id),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN('not_required','pending','verified','rejected')),
  promo_code_id UUID REFERENCES promo_codes(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','activated','rejected','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS active_seller_activation_idx ON seller_store_activations(account_id) WHERE status IN('pending','approved');

CREATE TABLE IF NOT EXISTS promo_code_redemptions(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id UUID NOT NULL REFERENCES promo_codes(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  activation_id UUID NOT NULL UNIQUE REFERENCES seller_store_activations(id),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(promo_code_id,account_id)
);
