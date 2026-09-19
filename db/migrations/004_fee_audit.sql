CREATE UNIQUE INDEX IF NOT EXISTS listings_id_seller_unique_idx ON listings(id,seller_id);
DO $m$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='order_items_listing_seller_fk') THEN
    ALTER TABLE order_items ADD CONSTRAINT order_items_listing_seller_fk FOREIGN KEY(listing_id,seller_id) REFERENCES listings(id,seller_id);
  END IF;
END
$m$;

CREATE TABLE IF NOT EXISTS order_fee_entries(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK(side IN('buyer','seller')),
  amount_minor BIGINT NOT NULL CHECK(amount_minor>=0),
  policy_version INTEGER NOT NULL REFERENCES fee_policies(version),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id,side)
);

CREATE TABLE IF NOT EXISTS seller_ratings(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  seller_account_id UUID NOT NULL REFERENCES sellers(account_id),
  buyer_account_id UUID NOT NULL REFERENCES accounts(id),
  score SMALLINT NOT NULL CHECK(score BETWEEN 1 AND 5),
  comment TEXT CHECK(comment IS NULL OR char_length(comment)<=2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id,buyer_account_id,seller_account_id)
);

CREATE TABLE IF NOT EXISTS listing_reports(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id),
  reporter_account_id UUID REFERENCES accounts(id),
  reason_code TEXT NOT NULL,
  details TEXT CHECK(details IS NULL OR char_length(details)<=5000),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','reviewing','resolved','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
