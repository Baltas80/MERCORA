CREATE TABLE IF NOT EXISTS blockchain_transactions(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),asset_code CHAR(3) NOT NULL CHECK(asset_code IN('BTC','LTC','XMR')),network TEXT NOT NULL,txid TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN('deposit','withdrawal')),amount_atomic NUMERIC(78,0) NOT NULL CHECK(amount_atomic>0),
  confirmations INTEGER NOT NULL DEFAULT 0 CHECK(confirmations>=0),state TEXT NOT NULL DEFAULT 'observed',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(asset_code,network,txid,direction)
);
CREATE TABLE IF NOT EXISTS deposit_addresses(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),account_id UUID NOT NULL REFERENCES accounts(id),asset_code CHAR(3) NOT NULL CHECK(asset_code IN('BTC','LTC','XMR')),
  network TEXT NOT NULL,address_ref TEXT NOT NULL,derivation_ref TEXT,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(asset_code,network,address_ref)
);
CREATE INDEX IF NOT EXISTS deposit_addresses_account_idx ON deposit_addresses(account_id,asset_code,active);

CREATE TABLE IF NOT EXISTS withdrawal_requests(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),account_id UUID NOT NULL REFERENCES accounts(id),asset_code CHAR(3) NOT NULL CHECK(asset_code IN('BTC','LTC','XMR')),
  amount_atomic NUMERIC(78,0) NOT NULL CHECK(amount_atomic>0),destination_ref TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'requested' CHECK(state IN('requested','risk_review','approved','signing','broadcast','confirmed','rejected','cancelled','blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS withdrawal_queue_idx ON withdrawal_requests(state,created_at);

CREATE TABLE IF NOT EXISTS reconciliation_runs(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),asset_code CHAR(3) NOT NULL CHECK(asset_code IN('BTC','LTC','XMR')),network TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('running','matched','mismatch','blocked','failed')),onchain_atomic NUMERIC(78,0) NOT NULL DEFAULT 0,
  internal_liability_atomic NUMERIC(78,0) NOT NULL DEFAULT 0,delta_atomic NUMERIC(78,0) NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),finished_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS reconciliation_items(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),run_id UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  external_ref TEXT,ledger_ref UUID,expected_atomic NUMERIC(78,0),observed_atomic NUMERIC(78,0),status TEXT NOT NULL CHECK(status IN('matched','missing','unexpected','mismatch')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS system_state(
  key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO system_state(key,value) VALUES('marketplace_mode','normal'),('custody_mode','normal') ON CONFLICT(key) DO NOTHING;
CREATE TABLE IF NOT EXISTS emergency_events(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),action TEXT NOT NULL,actor_account_id UUID REFERENCES accounts(id),reason TEXT NOT NULL,
  state_before TEXT,state_after TEXT NOT NULL,authorization_ref TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
