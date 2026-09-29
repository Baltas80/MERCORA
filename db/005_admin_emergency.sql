-- MERCORA administrative emergency-control metadata.
-- This migration contains no private keys, seeds, mnemonics, wallet credentials or signing material.

CREATE TABLE IF NOT EXISTS emergency_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code TEXT NOT NULL REFERENCES assets(code),
  network TEXT NOT NULL CHECK (length(network) BETWEEN 1 AND 64),
  destination TEXT NOT NULL CHECK (length(destination) BETWEEN 1 AND 512),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 160),
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(asset_code, network, destination)
);

CREATE INDEX IF NOT EXISTS idx_emergency_destinations_asset
  ON emergency_destinations(asset_code, network, enabled);

CREATE TABLE IF NOT EXISTS panic_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by TEXT NOT NULL CHECK (length(requested_by) BETWEEN 1 AND 256),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  requested_state TEXT NOT NULL CHECK (requested_state IN ('freeze','sweep')),
  state TEXT NOT NULL DEFAULT 'requested'
    CHECK (state IN ('requested','authorizing','authorized','executing','completed','failed','cancelled')),
  custody_operation_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_panic_operations_created
  ON panic_operations(created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_chain (
  sequence BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 256),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 128),
  resource TEXT NOT NULL CHECK (length(resource) BETWEEN 1 AND 256),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_hash TEXT,
  event_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_audit_chain_sequence
  ON admin_audit_chain(sequence);

-- Audit metadata must be operational metadata only. Application code must reject
-- secret-bearing fields before insertion and calculate event_hash from a canonical
-- representation including previous_hash, actor, action, resource and metadata.
