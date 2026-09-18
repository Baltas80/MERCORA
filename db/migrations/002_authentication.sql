-- Authentication/session persistence.
-- Migration 001 remains immutable; all production changes are append-only.

ALTER TABLE accounts
    ADD COLUMN role TEXT NOT NULL DEFAULT 'buyer';

ALTER TABLE accounts
    ADD CONSTRAINT accounts_role_check
    CHECK (role IN ('buyer', 'seller', 'moderator', 'admin'));

CREATE UNIQUE INDEX accounts_pseudonym_lower_idx
    ON accounts (lower(pseudonym));

CREATE TABLE sessions (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT sessions_expiry_check CHECK (expires_at > created_at),
    CONSTRAINT sessions_revocation_check CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX sessions_account_active_idx
    ON sessions (account_id, expires_at)
    WHERE revoked_at IS NULL;

CREATE INDEX sessions_expiry_idx
    ON sessions (expires_at)
    WHERE revoked_at IS NULL;
