CREATE TABLE IF NOT EXISTS sessions(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  CHECK(expires_at>created_at),
  CHECK(revoked_at IS NULL OR revoked_at>=created_at)
);
CREATE INDEX IF NOT EXISTS sessions_account_active_idx ON sessions(account_id,expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS recovery_codes(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code_hash BYTEA NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS recovery_codes_account_idx ON recovery_codes(account_id,used_at);

CREATE TABLE IF NOT EXISTS admin_mfa_credentials(
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  encrypted_secret BYTEA NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'AES-256-GCM',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at TIMESTAMPTZ
);
