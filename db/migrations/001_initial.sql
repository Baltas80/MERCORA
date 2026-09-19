CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pseudonym TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','closed')),
  role TEXT NOT NULL DEFAULT 'buyer' CHECK(role IN ('buyer','seller','moderator','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_pseudonym_lower_idx ON accounts(lower(pseudonym));

CREATE TABLE IF NOT EXISTS sellers(
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  reputation_score NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK(reputation_score>=0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES sellers(account_id),
  category_id UUID REFERENCES categories(id),
  title TEXT NOT NULL CHECK(char_length(title) BETWEEN 3 AND 160),
  description TEXT NOT NULL CHECK(char_length(description) BETWEEN 1 AND 10000),
  price_minor BIGINT NOT NULL CHECK(price_minor>=0),
  currency CHAR(3) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity>=0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','sold','removed','blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listings_category_status_idx ON listings(category_id,status);
CREATE INDEX IF NOT EXISTS listings_seller_status_idx ON listings(seller_id,status);
CREATE INDEX IF NOT EXISTS listings_status_created_idx ON listings(status,created_at DESC);
