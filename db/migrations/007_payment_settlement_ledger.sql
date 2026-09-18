-- Payment settlement and seller balance ledger foundation.
-- Append-only migration; previous migrations remain immutable.

CREATE TABLE payment_intents (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    method TEXT NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency CHAR(3) NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    provider_reference TEXT,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payment_intent_method_check
        CHECK (method IN ('bitcoin', 'litecoin', 'monero', 'lightning')),
    CONSTRAINT payment_intent_status_check
        CHECK (status IN (
            'created', 'awaiting_payment', 'detected', 'confirming', 'confirmed',
            'failed', 'expired', 'cancelled', 'refunded'
        ))
);

CREATE UNIQUE INDEX payment_intents_order_active_idx
    ON payment_intents (order_id)
    WHERE status IN ('created', 'awaiting_payment', 'detected', 'confirming', 'confirmed');

CREATE INDEX payment_intents_provider_reference_idx
    ON payment_intents (provider_reference)
    WHERE provider_reference IS NOT NULL;

CREATE TABLE seller_balance_ledger (
    id UUID PRIMARY KEY,
    seller_id UUID NOT NULL REFERENCES sellers(account_id),
    order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
    escrow_id UUID REFERENCES seller_escrows(id) ON DELETE RESTRICT,
    currency CHAR(3) NOT NULL,
    entry_type TEXT NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT seller_balance_entry_type_check
        CHECK (entry_type IN ('escrow_release', 'payout')),
    CONSTRAINT seller_balance_source_check
        CHECK (escrow_id IS NOT NULL OR order_id IS NOT NULL)
);

CREATE UNIQUE INDEX seller_balance_escrow_release_once_idx
    ON seller_balance_ledger (escrow_id, entry_type)
    WHERE entry_type = 'escrow_release';

CREATE INDEX seller_balance_seller_idx
    ON seller_balance_ledger (seller_id, currency, created_at DESC);

COMMENT ON TABLE payment_intents IS
    'Server-side payment intent state. Client-submitted transaction identifiers are never authoritative for settlement.';

COMMENT ON TABLE seller_balance_ledger IS
    'Append-only seller settlement ledger. A released escrow can credit seller availability exactly once.';
