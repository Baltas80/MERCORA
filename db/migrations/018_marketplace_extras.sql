CREATE TABLE IF NOT EXISTS favorites(
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,listing_id)
);
CREATE INDEX IF NOT EXISTS favorites_account_idx ON favorites(account_id,created_at DESC);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS shipping_required BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS listing_images(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  upload_id UUID NOT NULL REFERENCES uploads(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order>=0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(listing_id,upload_id)
);
CREATE INDEX IF NOT EXISTS listing_images_listing_idx ON listing_images(listing_id,sort_order);
ALTER TABLE shipping_records ADD COLUMN IF NOT EXISTS actor_account_id UUID REFERENCES accounts(id);
ALTER TABLE shipping_records ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'order_delivery';
CREATE INDEX IF NOT EXISTS moderation_cases_resource_idx ON moderation_cases(resource_type,resource_id,status,created_at DESC);