import unittest
from datetime import datetime, timezone
from uuid import uuid4

from escrow import (
    EscrowPolicy,
    EscrowStatus,
    can_transition,
    calculate_seller_escrow_amount,
    release_eligible_at,
)
from orders import CartLine


class EscrowPolicyTests(unittest.TestCase):
    def test_new_seller_requires_escrow(self):
        policy = EscrowPolicy(
            version=1,
            successful_orders_required=5,
            hold_after_delivery_seconds=72 * 3600,
        )
        self.assertTrue(policy.requires_escrow(0))
        self.assertTrue(policy.requires_escrow(4))
        self.assertFalse(policy.requires_escrow(5))

    def test_negative_successful_orders_are_rejected(self):
        policy = EscrowPolicy(
            version=1,
            successful_orders_required=5,
            hold_after_delivery_seconds=72 * 3600,
        )
        with self.assertRaises(ValueError):
            policy.requires_escrow(-1)


class EscrowStateTests(unittest.TestCase):
    def test_dispute_can_block_release_until_resolved(self):
        self.assertTrue(can_transition(EscrowStatus.HELD, EscrowStatus.DISPUTED))
        self.assertTrue(can_transition(EscrowStatus.DISPUTED, EscrowStatus.RELEASED))
        self.assertTrue(can_transition(EscrowStatus.DISPUTED, EscrowStatus.REFUNDED))

    def test_terminal_states_cannot_change(self):
        for terminal in (EscrowStatus.RELEASED, EscrowStatus.REFUNDED):
            self.assertFalse(can_transition(terminal, EscrowStatus.HELD))
            self.assertFalse(can_transition(terminal, EscrowStatus.DISPUTED))


class EscrowAmountTests(unittest.TestCase):
    def test_escrow_holds_seller_net_after_seller_fee(self):
        seller = uuid4()
        other = uuid4()
        lines = [
            CartLine(uuid4(), seller, 10001, 1, "EUR"),
            CartLine(uuid4(), seller, 9999, 1, "EUR"),
            CartLine(uuid4(), other, 10000, 1, "EUR"),
        ]
        amounts = calculate_seller_escrow_amount(lines, seller, 500)
        self.assertEqual(amounts.seller_gross_minor, 20000)
        self.assertEqual(amounts.seller_fee_minor, 1001)
        self.assertEqual(amounts.seller_net_minor, 18999)

    def test_release_time_uses_delivery_timestamp(self):
        delivered = datetime(2026, 9, 18, 12, 0, tzinfo=timezone.utc)
        policy = EscrowPolicy(
            version=1,
            successful_orders_required=5,
            hold_after_delivery_seconds=72 * 3600,
        )
        self.assertEqual(
            release_eligible_at(delivered, policy),
            datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc),
        )

    def test_naive_delivery_timestamp_is_rejected(self):
        delivered = datetime(2026, 9, 18, 12, 0)
        policy = EscrowPolicy(
            version=1,
            successful_orders_required=5,
            hold_after_delivery_seconds=72 * 3600,
        )
        with self.assertRaises(ValueError):
            release_eligible_at(delivered, policy)


if __name__ == "__main__":
    unittest.main()
