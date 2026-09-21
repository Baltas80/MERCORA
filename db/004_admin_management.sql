-- MERCORA administrative management model.
-- This migration contains no credentials, wallet keys or private Tor material.

CREATE TABLE IF NOT EXISTS mercora_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  owner_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','suspended','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mercora_stores_owner ON mercora_stores(owner_account_id);
CREATE INDEX IF NOT EXISTS idx_mercora_stores_status ON mercora_stores(status);

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES mercora_stores(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_listings_store_status
  ON listings(store_id, status);

CREATE TABLE IF NOT EXISTS store_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES mercora_stores(id) ON DELETE CASCADE,
  owner_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('assigned','unassigned')),
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_bans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 2000),
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lifted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_account_bans_account_active
  ON account_bans(account_id, active);

CREATE TABLE IF NOT EXISTS promotion_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL UNIQUE,
  code_prefix TEXT NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_bps INTEGER CHECK (discount_type <> 'percent' OR (discount_bps > 0 AND discount_bps <= 10000)),
  discount_atomic NUMERIC(78,0) CHECK (discount_type <> 'fixed' OR (discount_atomic > 0)),
  discount_asset TEXT REFERENCES assets(code),
  max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redeemed_count INTEGER NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0),
  min_order_atomic NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (min_order_atomic >= 0),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (discount_type = 'percent' AND discount_bps IS NOT NULL AND discount_atomic IS NULL)
    OR
    (discount_type = 'fixed' AND discount_bps IS NULL AND discount_atomic IS NOT NULL AND discount_asset IS NOT NULL)
  ),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_promotion_codes_active_window
  ON promotion_codes(active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS discount_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type TEXT NOT NULL CHECK (target_type IN ('global','store','listing','category')),
  target_id UUID,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_bps INTEGER CHECK (discount_type <> 'percent' OR (discount_bps > 0 AND discount_bps <= 10000)),
  discount_atomic NUMERIC(78,0) CHECK (discount_type <> 'fixed' OR (discount_atomic > 0)),
  discount_asset TEXT REFERENCES assets(code),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (target_type = 'global' AND target_id IS NULL)
    OR
    (target_type <> 'global' AND target_id IS NOT NULL)
  ),
  CHECK (
    (discount_type = 'percent' AND discount_bps IS NOT NULL AND discount_atomic IS NULL)
    OR
    (discount_type = 'fixed' AND discount_bps IS NULL AND discount_atomic IS NOT NULL AND discount_asset IS NOT NULL)
  ),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_discount_rules_target ON discount_rules(target_type, target_id, active);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS homepage_featured_listings (
  listing_id UUID PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL UNIQUE CHECK (position BETWEEN 1 AND 48),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE listing_reports
  ADD COLUMN IF NOT EXISTS admin_note TEXT,
  ADD COLUMN IF NOT EXISTS handled_by TEXT,
  ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_listing_reports_status_created
  ON listing_reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_resource ON admin_audit_log(resource_type, resource_id);

INSERT INTO site_settings(key, value, updated_by) VALUES
  ('site_name', 'MERCORA', 'migration'),
  ('site_mode', 'public', 'migration'),
  ('announcement', '', 'migration'),
  ('maintenance_message', '', 'migration'),
  ('new_listings_enabled', 'true', 'migration'),
  ('seller_registration_enabled', 'true', 'migration'),
  ('footer_notice', '', 'migration'),
  ('hero_title', 'Buy. Sell. Keep control.', 'migration'),
  ('hero_copy', 'A second-hand marketplace built around privacy, strong security boundaries and a clean buying experience.', 'migration'),
  ('buy_cta', 'Browse listings', 'migration'),
  ('sell_cta', 'List an item', 'migration')
ON CONFLICT (key) DO NOTHING;
