ALTER TABLE payment_fee_allocations DROP CONSTRAINT IF EXISTS payment_fee_allocations_kind_check;
ALTER TABLE payment_fee_allocations ADD CONSTRAINT payment_fee_allocations_kind_check CHECK(kind IN('buyer_fee','seller_fee','blockchain_fee','adjustment'));
