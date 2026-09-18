-- MERCORA Core ledger schema (PostgreSQL)
-- No private keys, seeds or blockchain credentials belong here.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assets (
  code TEXT PRIMARY KEY,
  atomic_scale SMALLINT NOT NULL CHECK (atomic_scale >= 0 AND atomic_scale <= 30),
  active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO assets(code, atomic_scale) VALUES
  ('BTC', 8), ('LTC', 8), ('XMR', 12)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  transaction_type TEXT NOT NULL,
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  asset_code TEXT NOT NULL REFERENCES assets(code),
  amount_atomic NUMERIC(78,0) NOT NULL CHECK (amount_atomic <> 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_asset
  ON ledger_entries(account_id, asset_code);

CREATE TABLE IF NOT EXISTS blockchain_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code TEXT NOT NULL REFERENCES assets(code),
  network TEXT NOT NULL,
  txid TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('deposit','withdrawal')),
  amount_atomic NUMERIC(78,0) NOT NULL CHECK (amount_atomic > 0),
  confirmations INTEGER NOT NULL DEFAULT 0 CHECK (confirmations >= 0),
  state TEXT NOT NULL DEFAULT 'observed',
  UNIQUE(asset_code, network, txid, direction)
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  asset_code TEXT NOT NULL REFERENCES assets(code),
  amount_atomic NUMERIC(78,0) NOT NULL CHECK (amount_atomic > 0),
  destination TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','approved','broadcast','confirmed','rejected','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emergency_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  state_before TEXT,
  state_after TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_state(key, value) VALUES ('custody_mode', 'normal')
ON CONFLICT (key) DO NOTHING;

-- Application code must enforce double-entry balancing inside one DB transaction.
-- Direct balance columns are intentionally absent: balances are derived from ledger_entries.
