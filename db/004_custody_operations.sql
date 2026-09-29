-- MERCORA custody operational metadata.
-- No private keys, seeds, signing credentials or secret material belong here.

CREATE TABLE IF NOT EXISTS deposit_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  asset_code TEXT NOT NULL REFERENCES assets(code),
  network TEXT NOT NULL CHECK (length(network) BETWEEN 1 AND 64),
  address TEXT NOT NULL CHECK (length(address) BETWEEN 1 AND 256),
  provider_reference TEXT NOT NULL CHECK (length(provider_reference) BETWEEN 1 AND 256),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','retired','frozen')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  UNIQUE(asset_code, network, address)
);

CREATE INDEX IF NOT EXISTS idx_deposit_addresses_account_asset
  ON deposit_addresses(account_id, asset_code, network);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code TEXT NOT NULL REFERENCES assets(code),
  network TEXT NOT NULL CHECK (length(network) BETWEEN 1 AND 64),
  state TEXT NOT NULL DEFAULT 'started'
    CHECK (state IN ('started','completed','discrepancy','failed')),
  scanned_from TEXT,
  scanned_to TEXT,
  discrepancy_count INTEGER NOT NULL DEFAULT 0 CHECK (discrepancy_count >= 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_asset_time
  ON reconciliation_runs(asset_code, network, started_at DESC);
