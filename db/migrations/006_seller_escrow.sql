-- Seller escrow foundation. Previous migrations remain immutable.
--
-- New-seller protection is versioned and evaluated when an order is funded.
-- The initial operational policy requires escrow for the first five successfully
-- completed orders and keeps seller net funds held for 72 hours after delivery.
-- Both values are data, not application constants, and can be replaced by a
-- future policy version without rewriting historical escrows.

CREATE TABLE escrow_policies (
    version INTEGER PRIMARY KEY,
    successful_orders_required INTEGER NOT NULL CHECK (successful_orders_required >= 0),
    hold_after_delivery_seconds BIGINT NOT NULL CHECK (hold_after_delivery_seconds > 0),
    active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX escrow_policies_single_active_idx
    ON escrow_policies (active)
    WHERE active;

INSERT INTO escrow_policies (
    version,
    successful_orders_required,
    hold_after_delivery_seconds,
    active
) VALUES (1, 5, 259200, TRUE);

CREATE INDEX order_items_seller_order_idx
    ON order_items (seller_id, order_id);

CREATE VIEW seller_completed_order_counts AS
SELECT
    oi.seller_id,
    COUNT(DISTINCT oi.order_id)::BIGINT AS completed_order_count
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.status = 'completed'
GROUP BY oi.seller_id;

CREATE TABLE seller_escrows (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id),
    seller_id UUID NOT NULL REFERENCES sellers(account_id),
    currency CHAR(3) NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    policy_version INTEGER NOT NULL REFERENCES escrow_policies(version),
    status TEXT NOT NULL DEFAULT 'held',
    release_eligible_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT seller_escrow_status_check
        CHECK (status IN ('held', 'disputed', 'released', 'refunded'))
);

CREATE UNIQUE INDEX seller_escrows_order_seller_idx
    ON seller_escrows (order_id, seller_id);

CREATE INDEX seller_escrows_seller_status_idx
    ON seller_escrows (seller_id, status, created_at DESC);

CREATE INDEX seller_escrows_release_idx
    ON seller_escrows (release_eligible_at)
    WHERE status = 'held' AND release_eligible_at IS NOT NULL;

CREATE TABLE escrow_ledger_entries (
    id UUID PRIMARY KEY,
    escrow_id UUID NOT NULL REFERENCES seller_escrows(id),
    order_id UUID NOT NULL REFERENCES orders(id),
    seller_id UUID NOT NULL REFERENCES sellers(account_id),
    currency CHAR(3) NOT NULL,
    entry_type TEXT NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT escrow_ledger_entry_type_check
        CHECK (entry_type IN ('hold', 'release', 'refund'))
);

CREATE UNIQUE INDEX escrow_ledger_one_type_per_escrow_idx
    ON escrow_ledger_entries (escrow_id, entry_type);

CREATE INDEX escrow_ledger_seller_idx
    ON escrow_ledger_entries (seller_id, created_at DESC);

COMMENT ON TABLE seller_escrows IS
    'Seller net settlement held from payout for new-seller protection. Escrow is created only from server-verified funded orders.';

COMMENT ON TABLE escrow_ledger_entries IS
    'Append-only accounting trail for seller escrow holds, releases and refunds. Entries are idempotent per escrow and type.';
