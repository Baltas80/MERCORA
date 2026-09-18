CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY,
    pseudonym TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT accounts_status_check CHECK (status IN ('active', 'suspended', 'closed'))
);

CREATE TABLE IF NOT EXISTS sellers (
    account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    reputation_score NUMERIC(6,3) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings (
    id UUID PRIMARY KEY,
    seller_id UUID NOT NULL REFERENCES sellers(account_id),
    category_id UUID NOT NULL REFERENCES categories(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
    currency CHAR(3) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT listings_status_check CHECK (status IN ('draft', 'active', 'paused', 'sold', 'removed'))
);

CREATE INDEX IF NOT EXISTS listings_seller_idx ON listings (seller_id);
CREATE INDEX IF NOT EXISTS listings_category_status_idx ON listings (category_id, status);
CREATE INDEX IF NOT EXISTS listings_status_created_idx ON listings (status, created_at DESC);
