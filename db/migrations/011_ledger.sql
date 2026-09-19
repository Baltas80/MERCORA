CREATE TABLE IF NOT EXISTS ledger_accounts(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),code TEXT NOT NULL,asset_code CHAR(3) NOT NULL CHECK(asset_code IN('BTC','LTC','XMR')),
  owner_account_id UUID REFERENCES accounts(id),account_type TEXT NOT NULL CHECK(account_type IN('customer_liability','escrow','platform_revenue','blockchain_fee','treasury','unallocated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(code,asset_code)
);
CREATE TABLE IF NOT EXISTS ledger_transactions(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),idempotency_key TEXT NOT NULL UNIQUE,asset_code CHAR(3) NOT NULL CHECK(asset_code IN('BTC','LTC','XMR')),
  transaction_type TEXT NOT NULL,reference_type TEXT,reference_id UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ledger_entries(
  id BIGSERIAL PRIMARY KEY,transaction_id UUID NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  ledger_account_id UUID NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,asset_code CHAR(3) NOT NULL CHECK(asset_code IN('BTC','LTC','XMR')),
  direction TEXT NOT NULL CHECK(direction IN('debit','credit')),amount_atomic NUMERIC(78,0) NOT NULL CHECK(amount_atomic>0),created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_entries_account_asset_idx ON ledger_entries(ledger_account_id,asset_code,created_at);
CREATE OR REPLACE FUNCTION enforce_ledger_transaction_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n INTEGER; deb NUMERIC(78,0); cre NUMERIC(78,0); mismatches INTEGER;
BEGIN
  SELECT count(*),COALESCE(sum(amount_atomic) FILTER(WHERE direction='debit'),0),COALESCE(sum(amount_atomic) FILTER(WHERE direction='credit'),0)
    INTO n,deb,cre FROM ledger_entries WHERE transaction_id=NEW.id;
  SELECT count(*) INTO mismatches FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id WHERE e.transaction_id=NEW.id AND e.asset_code<>t.asset_code;
  IF n<2 OR deb<>cre OR mismatches>0 THEN RAISE EXCEPTION 'unbalanced_ledger_transaction'; END IF;
  RETURN NULL;
END $$;
DO $m$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='ledger_transaction_balanced_ct') THEN
    CREATE CONSTRAINT TRIGGER ledger_transaction_balanced_ct AFTER INSERT OR UPDATE ON ledger_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_ledger_transaction_balance();
  END IF;
END
$m$;
CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ledger_append_only'; END $$;
CREATE OR REPLACE FUNCTION prevent_ledger_entry_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ledger_append_only'; END $$;
DROP TRIGGER IF EXISTS ledger_entries_immutable ON ledger_entries;
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_mutation();
