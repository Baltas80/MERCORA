-- MERCORA administration, seller scoring and payout eligibility.
-- Financial actions remain fail-closed and must be executed by the payment subsystem.

CREATE TABLE IF NOT EXISTS admin_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_role_bindings (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (account_id, role_id)
);

CREATE TABLE IF NOT EXISTS admin_permissions (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_role_permissions (
  role_id UUID NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES admin_permissions(code),
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_account_id UUID REFERENCES accounts(id),
  action_code TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  decision TEXT NOT NULL CHECK (decision IN ('allowed','denied')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_resource
  ON admin_audit_events(resource_type, resource_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_actor
  ON admin_audit_events(actor_account_id, created_at DESC);

INSERT INTO admin_roles(name, description) VALUES
  ('super_admin', 'Full operational visibility with separate approval for high-risk financial actions'),
  ('operations_admin', 'Marketplace, sellers, orders, disputes and moderation'),
  ('finance_admin', 'Payments, escrow, withdrawals and reconciliation'),
  ('moderation_admin', 'Reports, listings, sellers and abuse controls'),
  ('read_only_auditor', 'Read-only audit and reporting access')
ON CONFLICT (name) DO NOTHING;

INSERT INTO admin_permissions(code, description) VALUES
  ('users.read','View user accounts and account state'),
  ('users.manage','Freeze, disable or restore accounts'),
  ('sellers.read','View seller profiles and risk state'),
  ('sellers.manage','Manage seller/store operational state'),
  ('listings.read','View listings'),
  ('listings.manage','Moderate or remove listings'),
  ('orders.read','View orders and order state'),
  ('orders.manage','Manage operational order state'),
  ('payments.read','View payment intents and payment events'),
  ('escrow.read','View escrow state'),
  ('escrow.manage','Perform permitted escrow operations through the guarded service'),
  ('wallets.read','View custody-account and wallet metadata without exposing keys'),
  ('withdrawals.read','View withdrawal requests'),
  ('withdrawals.approve','Approve withdrawals through the guarded financial workflow'),
  ('payouts.read','View seller payout requests'),
  ('payouts.approve','Approve seller payout mode requests or payouts through guarded workflow'),
  ('points.read','View seller points and levels'),
  ('points.manage','Grant or deduct points through audited policy'),
  ('promos.manage','Create, revoke and inspect promotion codes'),
  ('settings.read','View operational settings'),
  ('settings.manage','Change non-secret operational settings'),
  ('audit.read','Read administrative audit records'),
  ('emergency.manage','Request or authorize emergency freeze/recovery according to policy')
ON CONFLICT (code) DO NOTHING;

INSERT INTO admin_role_permissions(role_id, permission_code)
SELECT r.id, p.code
FROM admin_roles r CROSS JOIN admin_permissions p
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

INSERT INTO admin_role_permissions(role_id, permission_code)
SELECT r.id, p.code
FROM admin_roles r JOIN admin_permissions p ON p.code IN (
  'users.read','users.manage','sellers.read','sellers.manage','listings.read','listings.manage',
  'orders.read','orders.manage','points.read','points.manage','promos.manage','audit.read'
)
WHERE r.name = 'operations_admin'
ON CONFLICT DO NOTHING;

INSERT INTO admin_role_permissions(role_id, permission_code)
SELECT r.id, p.code
FROM admin_roles r JOIN admin_permissions p ON p.code IN (
  'sellers.read','payments.read','escrow.read','escrow.manage','wallets.read',
  'withdrawals.read','withdrawals.approve','payouts.read','payouts.approve','audit.read','emergency.manage'
)
WHERE r.name = 'finance_admin'
ON CONFLICT DO NOTHING;

INSERT INTO admin_role_permissions(role_id, permission_code)
SELECT r.id, p.code
FROM admin_roles r JOIN admin_permissions p ON p.code IN (
  'users.read','sellers.read','sellers.manage','listings.read','listings.manage','orders.read','audit.read'
)
WHERE r.name = 'moderation_admin'
ON CONFLICT DO NOTHING;

INSERT INTO admin_role_permissions(role_id, permission_code)
SELECT r.id, p.code
FROM admin_roles r JOIN admin_permissions p ON p.code IN (
  'users.read','sellers.read','listings.read','orders.read','payments.read','escrow.read',
  'wallets.read','withdrawals.read','payouts.read','points.read','audit.read','settings.read'
)
WHERE r.name = 'read_only_auditor'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS seller_point_levels (
  level SMALLINT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  min_points BIGINT NOT NULL CHECK (min_points >= 0),
  min_completed_sales INTEGER NOT NULL DEFAULT 0 CHECK (min_completed_sales >= 0),
  max_dispute_rate_bps INTEGER NOT NULL DEFAULT 10000 CHECK (max_dispute_rate_bps BETWEEN 0 AND 10000),
  max_early_release_atomic NUMERIC(78,0),
  advance_payout_allowed BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO seller_point_levels(
  level, name, min_points, min_completed_sales, max_dispute_rate_bps,
  max_early_release_atomic, advance_payout_allowed
) VALUES
  (0, 'Nuevo', 0, 0, 10000, NULL, false),
  (1, 'Establecido', 100, 5, 2500, NULL, false),
  (2, 'Confiable', 500, 20, 1000, NULL, false),
  (3, 'Avanzado', 1500, 50, 500, 0, true),
  (4, 'Preferente', 3000, 100, 250, 0, true)
ON CONFLICT (level) DO NOTHING;

CREATE TABLE IF NOT EXISTS seller_points_ledger (
  id BIGSERIAL PRIMARY KEY,
  seller_account_id UUID NOT NULL REFERENCES accounts(id),
  delta_points INTEGER NOT NULL CHECK (delta_points <> 0),
  reason_code TEXT NOT NULL,
  reference_id UUID,
  idempotency_key TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seller_points_account_time
  ON seller_points_ledger(seller_account_id, created_at DESC);

CREATE OR REPLACE VIEW seller_point_balances AS
SELECT
  seller_account_id,
  COALESCE(SUM(delta_points), 0)::BIGINT AS points
FROM seller_points_ledger
GROUP BY seller_account_id;

CREATE TABLE IF NOT EXISTS seller_payout_policies (
  mode TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  requires_level SMALLINT NOT NULL REFERENCES seller_point_levels(level),
  buyer_protection_required BOOLEAN NOT NULL,
  admin_approval_required BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO seller_payout_policies(
  mode, label, requires_level, buyer_protection_required, admin_approval_required
) VALUES
  ('standard_escrow', 'Liquidación tras protección', 0, true, false),
  ('early_release', 'Liquidación anticipada limitada', 3, true, true),
  ('advance_payout', 'Pago anticipado al vendedor', 4, false, true)
ON CONFLICT (mode) DO NOTHING;

CREATE TABLE IF NOT EXISTS seller_payout_mode_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id UUID NOT NULL REFERENCES accounts(id),
  requested_mode TEXT NOT NULL REFERENCES seller_payout_policies(mode),
  seller_points_snapshot BIGINT NOT NULL CHECK (seller_points_snapshot >= 0),
  completed_sales_snapshot INTEGER NOT NULL CHECK (completed_sales_snapshot >= 0),
  dispute_rate_bps_snapshot INTEGER NOT NULL CHECK (dispute_rate_bps_snapshot BETWEEN 0 AND 10000),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','approved','rejected','suspended','revoked')),
  reviewed_by UUID REFERENCES accounts(id),
  review_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payout_mode_requests_seller
  ON seller_payout_mode_requests(seller_account_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_payout_mode_request
  ON seller_payout_mode_requests(seller_account_id, requested_mode)
  WHERE status = 'requested';

CREATE TABLE IF NOT EXISTS seller_payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id UUID NOT NULL REFERENCES accounts(id),
  order_id UUID REFERENCES orders(id),
  asset_code TEXT NOT NULL REFERENCES assets(code),
  amount_atomic NUMERIC(78,0) NOT NULL CHECK (amount_atomic > 0),
  mode TEXT NOT NULL REFERENCES seller_payout_policies(mode),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','risk_review','approved','processing','paid','rejected','cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seller_payout_requests_seller
  ON seller_payout_requests(seller_account_id, status, created_at DESC);

-- The application must verify the seller's current eligibility before changing
-- seller_payout_mode_requests to approved or executing a payout.
-- Points are evidence for eligibility, not a substitute for risk controls.


CREATE OR REPLACE FUNCTION record_seller_points(
  p_seller_account_id UUID,
  p_delta_points INTEGER,
  p_reason_code TEXT,
  p_reference_id UUID,
  p_idempotency_key TEXT,
  p_actor TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $points$
BEGIN
  IF p_delta_points = 0 THEN
    RAISE EXCEPTION 'invalid_points_delta';
  END IF;

  INSERT INTO seller_points_ledger(
    seller_account_id, delta_points, reason_code,
    reference_id, idempotency_key, actor
  )
  VALUES (
    p_seller_account_id, p_delta_points, p_reason_code,
    p_reference_id, p_idempotency_key, p_actor
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN FOUND;
END;
$points$;

-- Points must be awarded/deducted from authoritative server events only.
-- The client must never submit an arbitrary point balance or level.
CREATE TABLE IF NOT EXISTS seller_point_rules (
  reason_code TEXT PRIMARY KEY,
  delta_points INTEGER NOT NULL CHECK (delta_points <> 0),
  description TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO seller_point_rules(reason_code, delta_points, description) VALUES
  ('sale_completed', 10, 'Completed seller order'),
  ('verified_positive_review', 2, 'Verified positive buyer review'),
  ('refund_after_resolution', -20, 'Refund after dispute resolution'),
  ('policy_violation', -100, 'Confirmed marketplace policy violation'),
  ('fraud_confirmed', -500, 'Confirmed seller fraud')
ON CONFLICT (reason_code) DO NOTHING;

CREATE OR REPLACE FUNCTION award_seller_points_from_rule(
  p_seller_account_id UUID,
  p_reason_code TEXT,
  p_reference_id UUID,
  p_idempotency_key TEXT,
  p_actor TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $rule$
DECLARE
  rule_row seller_point_rules%ROWTYPE;
BEGIN
  SELECT * INTO rule_row FROM seller_point_rules WHERE reason_code = p_reason_code AND active = true FOR SHARE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  RETURN record_seller_points(
    p_seller_account_id, rule_row.delta_points, rule_row.reason_code,
    p_reference_id, p_idempotency_key, p_actor
  );
END;
$rule$;