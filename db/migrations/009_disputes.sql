CREATE TABLE IF NOT EXISTS disputes(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  opened_by UUID NOT NULL REFERENCES accounts(id),
  buyer_account_id UUID NOT NULL REFERENCES accounts(id),
  seller_account_id UUID NOT NULL REFERENCES sellers(account_id),
  reason_code TEXT NOT NULL CHECK(reason_code IN('non_delivery','item_not_as_described','damaged_in_transit','suspected_counterfeit','other')),
  description TEXT NOT NULL CHECK(char_length(description) BETWEEN 10 AND 10000),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','awaiting_buyer','awaiting_seller','under_review','mediation','decided','appealed','resolved','closed','rejected')),
  priority SMALLINT NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 3),
  assigned_to UUID REFERENCES accounts(id),
  response_deadline TIMESTAMPTZ,
  decision_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS active_dispute_order_seller_idx ON disputes(order_id,seller_account_id) WHERE status IN('open','awaiting_buyer','awaiting_seller','under_review','mediation','appealed');
CREATE TABLE IF NOT EXISTS dispute_evidence(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,submitted_by UUID NOT NULL REFERENCES accounts(id),
  object_key TEXT NOT NULL CHECK(char_length(object_key) BETWEEN 1 AND 512),media_type TEXT NOT NULL CHECK(char_length(media_type) BETWEEN 1 AND 128),
  byte_size BIGINT NOT NULL CHECK(byte_size>0),sha256 TEXT NOT NULL CHECK(sha256~'^[0-9a-f]{64}$'),
  scan_status TEXT NOT NULL DEFAULT 'pending' CHECK(scan_status IN('pending','clean','blocked','failed')),metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dispute_messages(
  id BIGSERIAL PRIMARY KEY,dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,author_account_id UUID REFERENCES accounts(id),
  author_role TEXT NOT NULL CHECK(author_role IN('buyer','seller','moderator','admin','system')),encrypted_body BYTEA NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dispute_events(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,actor_account_id UUID REFERENCES accounts(id),
  event_type TEXT NOT NULL,from_status TEXT,to_status TEXT,reason_code TEXT,idempotency_key TEXT NOT NULL UNIQUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dispute_decisions(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),dispute_id UUID NOT NULL UNIQUE REFERENCES disputes(id) ON DELETE CASCADE,decided_by UUID NOT NULL REFERENCES accounts(id),
  outcome TEXT NOT NULL CHECK(outcome IN('buyer_refund','seller_release','partial_settlement','no_change','reject')),
  refund_atomic NUMERIC(78,0) CHECK(refund_atomic IS NULL OR refund_atomic>=0),
  seller_release_atomic NUMERIC(78,0) CHECK(seller_release_atomic IS NULL OR seller_release_atomic>=0),
  asset_code CHAR(3) CHECK(asset_code IN('BTC','LTC','XMR')),
  rationale TEXT NOT NULL CHECK(char_length(rationale) BETWEEN 10 AND 10000),
  financial_action_status TEXT NOT NULL DEFAULT 'not_required' CHECK(financial_action_status IN('not_required','pending','executed','blocked','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dispute_appeals(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,opened_by UUID NOT NULL REFERENCES accounts(id),
  reason TEXT NOT NULL CHECK(char_length(reason) BETWEEN 10 AND 5000),status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','under_review','upheld','overturned','rejected','closed')),
  assigned_to UUID REFERENCES accounts(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS open_dispute_appeal_idx ON dispute_appeals(dispute_id) WHERE status IN('open','under_review');
CREATE TABLE IF NOT EXISTS dispute_policies(
  policy_key TEXT PRIMARY KEY,reason_code TEXT NOT NULL,buyer_response_hours INTEGER NOT NULL CHECK(buyer_response_hours>0),
  seller_response_hours INTEGER NOT NULL CHECK(seller_response_hours>0),review_hours INTEGER NOT NULL CHECK(review_hours>0),appeal_hours INTEGER NOT NULL CHECK(appeal_hours>0),active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO dispute_policies(policy_key,reason_code,buyer_response_hours,seller_response_hours,review_hours,appeal_hours) VALUES
('non_delivery','non_delivery',48,48,72,48),('item_not_as_described','item_not_as_described',48,48,72,48),('damaged_in_transit','damaged_in_transit',48,48,72,48),('suspected_counterfeit','suspected_counterfeit',72,72,120,72),('other','other',48,48,72,48)
ON CONFLICT(policy_key) DO NOTHING;
