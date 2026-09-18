-- Strengthen order/listing integrity. Previous migrations remain immutable.

CREATE UNIQUE INDEX listings_id_seller_unique_idx
    ON listings (id, seller_id);

ALTER TABLE order_items
    ADD CONSTRAINT order_items_listing_seller_fk
    FOREIGN KEY (listing_id, seller_id)
    REFERENCES listings (id, seller_id);

ALTER TABLE orders
    ADD CONSTRAINT orders_status_check
    CHECK (status IN (
        'pending_payment',
        'payment_detected',
        'payment_confirmed',
        'processing',
        'shipped',
        'delivered',
        'cancelled',
        'disputed',
        'refunded',
        'completed'
    ));

ALTER TABLE orders
    ADD CONSTRAINT orders_idempotency_length_check
    CHECK (char_length(idempotency_key) BETWEEN 16 AND 128);

ALTER TABLE order_items
    ADD CONSTRAINT order_items_currency_consistency_check
    CHECK (char_length(title_snapshot) BETWEEN 1 AND 500);
