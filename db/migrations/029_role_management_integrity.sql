CREATE UNIQUE INDEX IF NOT EXISTS admin_active_binding_idx ON admin_role_bindings(account_id,role_id) WHERE revoked_at IS NULL;
ALTER TABLE admin_action_requests ADD COLUMN IF NOT EXISTS step_up_method TEXT;
ALTER TABLE admin_approvals ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMPTZ;
