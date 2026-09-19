ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK(status IN('pending_payment','payment_detected','payment_confirmed','processing','shipped','delivered','cancelled','disputed','refunded','completed'));
INSERT INTO admin_permissions(code,description) VALUES('disputes.manage','manage dispute workflow and decisions') ON CONFLICT(code) DO NOTHING;
INSERT INTO admin_role_permissions(role_id,permission_code) SELECT r.id,'disputes.manage' FROM admin_roles r WHERE r.name IN('super_admin','operations_admin','moderation_admin') ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS disputes_assigned_queue_idx ON disputes(assigned_to,status,priority DESC,created_at) WHERE assigned_to IS NOT NULL;
