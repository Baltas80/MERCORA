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

DO $
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_seller_store_activation_code') THEN
    ALTER TABLE seller_stores
      ADD CONSTRAINT fk_seller_store_activation_code
      FOREIGN KEY (activation_code_id) REFERENCES promo_codes(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_activation_promo_code') THEN
    ALTER TABLE seller_store_activations
      ADD CONSTRAINT fk_activation_promo_code
      FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id);
  END IF;
END;
$;

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

DO $
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_activation_promo_source') THEN
    ALTER TABLE seller_store_activations
      ADD CONSTRAINT ck_activation_promo_source
      CHECK ((source = 'promo' AND promo_code_id IS NOT NULL) OR source = 'paid');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_store_promo_source') THEN
    ALTER TABLE seller_stores
      ADD CONSTRAINT ck_store_promo_source
      CHECK ((activation_source = 'promo' AND activation_code_id IS NOT NULL) OR activation_source = 'paid');
  END IF;
END;
$;

CREATE OR REPLACE FUNCTION redeem_promo_code(
  p_promo_code_id UUID,
  p_account_id UUID,
  p_activation_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  code_row promo_codes%ROWTYPE;
BEGIN
  SELECT *
    INTO code_row
    FROM promo_codes
   WHERE id = p_promo_code_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF code_row.status <> 'active'
     OR code_row.valid_from > now()
     OR (code_row.expires_at IS NOT NULL AND code_row.expires_at <= now())
     OR code_row.used_count >= code_row.max_uses THEN
    RETURN FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM seller_store_activations
     WHERE id = p_activation_id
       AND account_id = p_account_id
       AND source = 'promo'
       AND promo_code_id = p_promo_code_id
       AND status = 'pending'
  ) THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (SELECT 1 FROM seller_stores WHERE account_id = p_account_id) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO promo_code_redemptions(promo_code_id, account_id, activation_id)
  VALUES (p_promo_code_id, p_account_id, p_activation_id);

  UPDATE promo_codes
     SET used_count = used_count + 1,
         status = CASE
           WHEN used_count + 1 >= max_uses THEN 'exhausted'
           ELSE 'active'
         END
   WHERE id = p_promo_code_id;

  RETURN TRUE;
EXCEPTION
  WHEN unique_violation THEN
    RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION activate_seller_store(p_activation_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  activation seller_store_activations%ROWTYPE;
  store_id UUID;
  existing_store_status TEXT;
BEGIN
  SELECT *
    INTO activation
    FROM seller_store_activations
   WHERE id = p_activation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'activation_not_found';
  END IF;

  SELECT id, status
    INTO store_id, existing_store_status
    FROM seller_stores
   WHERE account_id = activation.account_id
   FOR UPDATE;

  IF store_id IS NOT NULL THEN
    IF existing_store_status = 'active' THEN
      RETURN store_id;
    END IF;
    RAISE EXCEPTION 'seller_store_not_active';
  END IF;

  IF activation.source = 'paid' AND activation.payment_status <> 'verified' THEN
    RAISE EXCEPTION 'payment_not_verified';
  END IF;

  IF activation.source = 'promo' AND NOT EXISTS (
    SELECT 1
      FROM promo_code_redemptions
     WHERE activation_id = activation.id
  ) THEN
    RAISE EXCEPTION 'promo_not_redeemed';
  END IF;

  INSERT INTO seller_stores (
    account_id, store_name, store_slug, status,
    activation_source, activation_code_id, activated_at, updated_at
  )
  VALUES (
    activation.account_id,
    activation.requested_store_name,
    activation.requested_store_slug,
    'active',
    activation.source,
    activation.promo_code_id,
    now(),
    now()
  )
  RETURNING id INTO store_id;

  UPDATE seller_profiles
     SET status = 'active',
         activated_at = now(),
         updated_at = now()
   WHERE account_id = activation.account_id;

  UPDATE seller_store_activations
     SET status = 'activated',
         updated_at = now()
   WHERE id = activation.id;

  RETURN store_id;
END;
$$;

-- Application code must hash plaintext promotion codes before lookup.
-- Paid activation may only set payment_status='verified' from the authoritative
-- payment subsystem; clients must never be allowed to set it directly.
