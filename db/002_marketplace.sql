-- MERCORA marketplace domain model.
-- Pseudonymous by design: no email, phone, legal name or address columns are required here.

CREATE TABLE IF NOT EXISTS seller_profiles (
  account_id UUID PRIMARY KEY REFERENCES accounts(id),
  display_name TEXT NOT NULL UNIQUE,
  rating_count INTEGER NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  rating_sum INTEGER NOT NULL DEFAULT 0 CHECK (rating_sum >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id UUID NOT NULL REFERENCES accounts(id),
  category_id UUID REFERENCES categories(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 160),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 10000),
  price_atomic NUMERIC(78,0) NOT NULL CHECK (price_atomic >= 0),
  price_asset TEXT NOT NULL REFERENCES assets(code),
  condition TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','reserved','sold','archived','blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listings_active_category
  ON listings(category_id, status);

CREATE INDEX IF NOT EXISTS idx_listings_active_seller
  ON listings(seller_account_id, status);

CREATE TABLE IF NOT EXISTS carts (
  account_id UUID PRIMARY KEY REFERENCES accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cart_items (
  cart_id UUID NOT NULL REFERENCES carts(account_id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 99),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cart_id, listing_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_account_id UUID NOT NULL REFERENCES accounts(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','awaiting_payment','paid','processing','shipped','completed','cancelled','disputed')),
  total_atomic NUMERIC(78,0) NOT NULL CHECK (total_atomic >= 0),
  total_asset TEXT NOT NULL REFERENCES assets(code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer_state
  ON orders(buyer_account_id, status);

CREATE TABLE IF NOT EXISTS order_items (
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id),
  seller_account_id UUID NOT NULL REFERENCES accounts(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_atomic NUMERIC(78,0) NOT NULL CHECK (unit_price_atomic >= 0),
  asset_code TEXT NOT NULL REFERENCES assets(code),
  PRIMARY KEY (order_id, listing_id)
);

CREATE TABLE IF NOT EXISTS listing_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id),
  reporter_account_id UUID REFERENCES accounts(id),
  reason_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','reviewing','resolved','dismissed'))
);

CREATE TABLE IF NOT EXISTS seller_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  seller_account_id UUID NOT NULL REFERENCES accounts(id),
  buyer_account_id UUID NOT NULL REFERENCES accounts(id),
  score SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT CHECK (comment IS NULL OR length(comment) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, buyer_account_id)
);

-- Inventory is represented by listing status/quantity at this stage.
-- Reservation/checkout transitions must be transactional and idempotent in application code.
