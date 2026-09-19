CREATE TABLE IF NOT EXISTS listing_inventory(
  listing_id UUID PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  available_quantity INTEGER NOT NULL CHECK(available_quantity>=0),
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK(reserved_quantity>=0),
  sold_quantity INTEGER NOT NULL DEFAULT 0 CHECK(sold_quantity>=0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(available_quantity+reserved_quantity+sold_quantity>=0)
);
CREATE TABLE IF NOT EXISTS carts(
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cart_items(
  cart_id UUID NOT NULL REFERENCES carts(account_id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(cart_id,listing_id)
);
CREATE TABLE IF NOT EXISTS fee_policies(
  version INTEGER PRIMARY KEY,
  buyer_fee_bps INTEGER NOT NULL CHECK(buyer_fee_bps BETWEEN 0 AND 10000),
  seller_fee_bps INTEGER NOT NULL CHECK(seller_fee_bps BETWEEN 0 AND 10000),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(buyer_fee_bps+seller_fee_bps<=10000)
);
CREATE UNIQUE INDEX IF NOT EXISTS fee_policies_single_active_idx ON fee_policies(active) WHERE active;
CREATE TABLE IF NOT EXISTS orders(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),buyer_id UUID NOT NULL REFERENCES accounts(id),
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK(status IN('pending_payment','payment_detected','payment_confirmed','processing','shipped','delivered','cancelled','disputed','refunded','completed')),
  currency CHAR(3) NOT NULL,subtotal_minor BIGINT NOT NULL CHECK(subtotal_minor>=0),buyer_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK(buyer_fee_minor>=0),
  seller_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK(seller_fee_minor>=0),total_minor BIGINT NOT NULL CHECK(total_minor>=0),
  fee_policy_version INTEGER NOT NULL REFERENCES fee_policies(version),idempotency_key TEXT NOT NULL CHECK(char_length(idempotency_key) BETWEEN 16 AND 128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),CHECK(total_minor=subtotal_minor+buyer_fee_minor)
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_buyer_idempotency_idx ON orders(buyer_id,idempotency_key);
CREATE INDEX IF NOT EXISTS orders_buyer_status_idx ON orders(buyer_id,status,created_at DESC);
CREATE TABLE IF NOT EXISTS order_items(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,listing_id UUID NOT NULL REFERENCES listings(id),
  seller_id UUID NOT NULL REFERENCES sellers(account_id),title_snapshot TEXT NOT NULL CHECK(char_length(title_snapshot) BETWEEN 1 AND 500),
  unit_price_minor BIGINT NOT NULL CHECK(unit_price_minor>=0),quantity INTEGER NOT NULL CHECK(quantity>0),seller_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK(seller_fee_minor>=0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_listing_idx ON order_items(listing_id);
CREATE INDEX IF NOT EXISTS order_items_seller_order_idx ON order_items(seller_id,order_id);
