CREATE TABLE IF NOT EXISTS shipping_records(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  encrypted_payload BYTEA NOT NULL,encryption_version TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS account_blocks(
  blocker_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,blocked_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(blocker_account_id,blocked_account_id),CHECK(blocker_account_id<>blocked_account_id)
);
CREATE TABLE IF NOT EXISTS messages(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),thread_key TEXT NOT NULL,order_id UUID REFERENCES orders(id),sender_account_id UUID NOT NULL REFERENCES accounts(id),
  recipient_account_id UUID NOT NULL REFERENCES accounts(id),encrypted_body BYTEA NOT NULL,encryption_version TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(sender_account_id<>recipient_account_id)
);
CREATE INDEX IF NOT EXISTS messages_recipient_created_idx ON messages(recipient_account_id,created_at DESC);
CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages(thread_key,created_at);

CREATE TABLE IF NOT EXISTS uploads(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),owner_account_id UUID NOT NULL REFERENCES accounts(id),object_key TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,byte_size BIGINT NOT NULL CHECK(byte_size>0),sha256 TEXT NOT NULL CHECK(sha256~'^[0-9a-f]{64}$'),
  purpose TEXT NOT NULL CHECK(purpose IN('listing_image','dispute_evidence','message_attachment')),
  scan_status TEXT NOT NULL DEFAULT 'pending' CHECK(scan_status IN('pending','clean','blocked','failed')),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uploads_owner_idx ON uploads(owner_account_id,created_at DESC);

CREATE TABLE IF NOT EXISTS notifications(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,read_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_account_idx ON notifications(account_id,created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_cases(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),resource_type TEXT NOT NULL,resource_id UUID NOT NULL,reported_by UUID REFERENCES accounts(id),
  reason_code TEXT NOT NULL,details TEXT,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','reviewing','actioned','dismissed')),
  assigned_to UUID REFERENCES accounts(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS moderation_queue_idx ON moderation_cases(status,created_at);
