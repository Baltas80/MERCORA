CREATE TABLE IF NOT EXISTS asset_quotes(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),asset_code CHAR(3) NOT NULL CHECK(asset_code IN('BTC','LTC','XMR')),
  fiat_currency CHAR(3) NOT NULL DEFAULT 'EUR',atomic_per_fiat_num NUMERIC(78,0) NOT NULL CHECK(atomic_per_fiat_num>0),
  atomic_per_fiat_den NUMERIC(78,0) NOT NULL CHECK(atomic_per_fiat_den>0),valid_until TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_quotes_current_idx ON asset_quotes(asset_code,fiat_currency,valid_until DESC);
CREATE TABLE IF NOT EXISTS payment_quotes(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),order_id UUID REFERENCES orders(id) ON DELETE CASCADE,account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  activation_id UUID,fiat_currency CHAR(3) NOT NULL,fiat_minor BIGINT NOT NULL CHECK(fiat_minor>=0),
  asset_code CHAR(3) NOT NULL CHECK(asset_code IN('BTC','LTC','XMR')),asset_atomic NUMERIC(78,0) NOT NULL CHECK(asset_atomic>0),
  rate_num NUMERIC(78,0) NOT NULL CHECK(rate_num>0),rate_den NUMERIC(78,0) NOT NULL CHECK(rate_den>0),valid_until TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK((order_id IS NOT NULL) OR (account_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS payment_quotes_order_idx ON payment_quotes(order_id,created_at DESC);
CREATE TABLE IF NOT EXISTS payment_intents(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),order_id UUID REFERENCES orders(id) ON DELETE CASCADE,account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  quote_id UUID REFERENCES payment_quotes(id),method TEXT NOT NULL CHECK(method IN('bitcoin','litecoin','monero','lightning')),
  asset_code CHAR(3) NOT NULL CHECK(asset_code IN('BTC','LTC','XMR')),network TEXT NOT NULL,amount_atomic NUMERIC(78,0) NOT NULL CHECK(amount_atomic>0),
  status TEXT NOT NULL DEFAULT 'created' CHECK(status IN('created','awaiting_payment','detected','confirming','confirmed','failed','expired','cancelled','refunded')),
  destination_ref TEXT, idempotency_key TEXT NOT NULL UNIQUE, external_reference TEXT, confirmations INTEGER NOT NULL DEFAULT 0 CHECK(confirmations>=0),
  expires_at TIMESTAMPTZ,confirmed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(order_id IS NOT NULL OR account_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_active_order_idx ON payment_intents(order_id) WHERE order_id IS NOT NULL AND status IN('created','awaiting_payment','detected','confirming');
CREATE TABLE IF NOT EXISTS payment_events(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),payment_intent_id UUID NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  asset_code CHAR(3) NOT NULL,network TEXT NOT NULL,txid TEXT,amount_atomic NUMERIC(78,0),confirmations INTEGER NOT NULL DEFAULT 0 CHECK(confirmations>=0),
  event_type TEXT NOT NULL,event_key TEXT NOT NULL UNIQUE,observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),raw_ref TEXT
);
