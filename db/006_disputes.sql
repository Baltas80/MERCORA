-- MERCORA dispute resolution domain.
-- Financial outcomes are decisions; actual escrow release/refund is executed only by the guarded payment service.

CREATE TABLE IF NOT EXISTS disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  opened_by UUID NOT NULL REFERENCES accounts(id),
  buyer_account_id UUID NOT NULL REFERENCES accounts(id),
  seller_account_id UUID NOT NULL REFERENCES accounts(id),
  reason_code TEXT NOT NULL,
  description TEXT NOT NULL CHECK (length(description) BETWEEN 10 AND 10000),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','awaiting_buyer','awaiting_seller','under_review','mediation','decided','appealed','resolved','closed','rejected')),
  priority SMALLINT NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  assigned_to UUID REFERENCES accounts(id),
  response_deadline TIMESTAMPTZ,
  decision_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_open_dispute_per_order
  ON disputes(order_id)
  WHERE status IN ('open','awaiting_buyer','awaiting_seller','under_review','mediation','appealed');

CREATE INDEX IF NOT EXISTS idx_disputes_queue
  ON disputes(status, priority DESC, created_at);

CREATE INDEX IF NOT EXISTS idx_disputes_parties
  ON disputes(buyer_account_id, seller_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dispute_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES accounts(id),
  object_key TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(object_key) BETWEEN 1 AND 512),
  CHECK (length(media_type) BETWEEN 1 AND 128)
);

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_dispute
  ON dispute_evidence(dispute_id, created_at);

CREATE TABLE IF NOT EXISTS dispute_messages (
  id BIGSERIAL PRIMARY KEY,
  dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  author_account_id UUID REFERENCES accounts(id),
  author_role TEXT NOT NULL CHECK (author_role IN ('buyer','seller','moderator','admin','system')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispute_messages_dispute
  ON dispute_messages(dispute_id, created_at);

CREATE TABLE IF NOT EXISTS dispute_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  actor_account_id UUID REFERENCES accounts(id),
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  reason_code TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispute_events_dispute
  ON dispute_events(dispute_id, created_at);

CREATE TABLE IF NOT EXISTS dispute_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL UNIQUE REFERENCES disputes(id) ON DELETE CASCADE,
  decided_by UUID NOT NULL REFERENCES accounts(id),
  outcome TEXT NOT NULL
    CHECK (outcome IN ('buyer_refund','seller_release','partial_settlement','no_change','reject')),
  refund_atomic NUMERIC(78,0) CHECK (refund_atomic IS NULL OR refund_atomic >= 0),
  seller_release_atomic NUMERIC(78,0) CHECK (seller_release_atomic IS NULL OR seller_release_atomic >= 0),
  asset_code TEXT REFERENCES assets(code),
  rationale TEXT NOT NULL CHECK (length(rationale) BETWEEN 10 AND 10000),
  financial_action_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (financial_action_status IN ('not_required','pending','executed','blocked','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dispute_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  opened_by UUID NOT NULL REFERENCES accounts(id),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 10 AND 5000),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','under_review','upheld','overturned','rejected','closed')),
  assigned_to UUID REFERENCES accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_open_appeal_per_dispute
  ON dispute_appeals(dispute_id)
  WHERE status IN ('open','under_review');

CREATE TABLE IF NOT EXISTS dispute_policies (
  policy_key TEXT PRIMARY KEY,
  reason_code TEXT NOT NULL,
  buyer_response_hours INTEGER NOT NULL CHECK (buyer_response_hours > 0),
  seller_response_hours INTEGER NOT NULL CHECK (seller_response_hours > 0),
  review_hours INTEGER NOT NULL CHECK (review_hours > 0),
  appeal_hours INTEGER NOT NULL CHECK (appeal_hours > 0),
  active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO dispute_policies(
  policy_key, reason_code, buyer_response_hours, seller_response_hours, review_hours, appeal_hours
) VALUES
  ('standard_non_delivery','non_delivery',48,48,72,48),
  ('item_not_as_described','item_not_as_described',48,48,72,48),
  ('damaged_in_transit','damaged_in_transit',48,48,72,48),
  ('suspected_counterfeit','suspected_counterfeit',72,72,120,72),
  ('other','other',48,48,72,48)
ON CONFLICT (policy_key) DO NOTHING;

CREATE OR REPLACE FUNCTION transition_dispute(
  p_dispute_id UUID,
  p_to_status TEXT,
  p_actor_account_id UUID,
  p_reason_code TEXT,
  p_idempotency_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $transition$
DECLARE
  d disputes%ROWTYPE;
BEGIN
  SELECT *
    INTO d
    FROM disputes
   WHERE id = p_dispute_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF p_to_status NOT IN (
    'open','awaiting_buyer','awaiting_seller','under_review',
    'mediation','decided','appealed','resolved','closed','rejected'
  ) THEN
    RAISE EXCEPTION 'invalid_dispute_status';
  END IF;

  IF d.status IN ('resolved','closed','rejected') THEN
    RETURN FALSE;
  END IF;

  IF p_to_status = d.status THEN
    INSERT INTO dispute_events(dispute_id, actor_account_id, event_type, from_status, to_status, reason_code, idempotency_key)
    VALUES (d.id, p_actor_account_id, 'idempotent_transition', d.status, d.status, p_reason_code, p_idempotency_key)
    ON CONFLICT (idempotency_key) DO NOTHING;
    RETURN TRUE;
  END IF;

  IF p_to_status = 'resolved' AND NOT EXISTS (
    SELECT 1 FROM dispute_decisions WHERE dispute_id = d.id
  ) THEN
    RAISE EXCEPTION 'decision_required';
  END IF;

  UPDATE disputes
     SET status = p_to_status,
         updated_at = now(),
         resolved_at = CASE WHEN p_to_status IN ('resolved','closed','rejected') THEN now() ELSE resolved_at END
   WHERE id = d.id;

  INSERT INTO dispute_events(
    dispute_id, actor_account_id, event_type, from_status, to_status,
    reason_code, idempotency_key
  ) VALUES (
    d.id, p_actor_account_id, 'status_transition', d.status,
    p_to_status, p_reason_code, p_idempotency_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN TRUE;
END;
$transition$;

-- A dispute decision is not itself a wallet operation.
-- The payment/escrow service must validate the decision, available funds,
-- idempotency and current escrow state before executing any financial outcome.
