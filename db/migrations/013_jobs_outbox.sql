CREATE TABLE IF NOT EXISTS jobs(
  id BIGSERIAL PRIMARY KEY,job_type TEXT NOT NULL,payload JSONB NOT NULL DEFAULT '{}'::jsonb,status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','succeeded','failed','dead')),
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),locked_at TIMESTAMPTZ,locked_by TEXT,last_error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(status,run_at);
CREATE TABLE IF NOT EXISTS outbox_events(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),event_key TEXT NOT NULL UNIQUE,event_type TEXT NOT NULL,aggregate_type TEXT NOT NULL,aggregate_id UUID,payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),processed_at TIMESTAMPTZ,attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox_events(processed_at,created_at) WHERE processed_at IS NULL;
CREATE TABLE IF NOT EXISTS admin_action_requests(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),requested_by UUID NOT NULL REFERENCES accounts(id),permission_code TEXT NOT NULL,resource_type TEXT,resource_id UUID,
  reason TEXT NOT NULL CHECK(char_length(reason)>=10),status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN('requested','approved','executed','rejected','expired','blocked')),
  step_up_at TIMESTAMPTZ,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),executed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS admin_approvals(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),action_request_id UUID NOT NULL REFERENCES admin_action_requests(id) ON DELETE CASCADE,
  approver_account_id UUID NOT NULL REFERENCES accounts(id),mfa_verified_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(action_request_id,approver_account_id)
);
