-- Backfill inventory for listings that already existed before the inventory boundary.
-- Add an explicit fee ledger so buyer/seller platform revenue is independently auditable.

INSERT INTO listing_inventory (listing_id, available_quantity)
SELECT id, quantity
FROM listings
ON CONFLICT (listing_id) DO NOTHING;

CREATE TABLE order_fee_entries (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    side TEXT NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    policy_version INTEGER NOT NULL REFERENCES fee_policies(version),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT order_fee_side_check CHECK (side IN ('buyer', 'seller'))
);

CREATE UNIQUE INDEX order_fee_entries_side_idx
    ON order_fee_entries (order_id, side);

CREATE INDEX order_fee_entries_policy_idx
    ON order_fee_entries (policy_version);

COMMENT ON COLUMN listings.quantity IS
    'Legacy inventory seed value. listing_inventory is authoritative after migration 004.';
