import unittest
from uuid import uuid4

from fees import FeePolicy
from orders import CartLine, calculate_order_amounts


class OrderCalculationTests(unittest.TestCase):
    def test_buyer_fee_is_added_to_buyer_total(self):
        policy = FeePolicy(version=1, buyer_fee_bps=250, seller_fee_bps=500)
        lines = [
            CartLine(uuid4(), uuid4(), 10000, 1, "EUR"),
            CartLine(uuid4(), uuid4(), 5000, 2, "EUR"),
        ]
        amounts = calculate_order_amounts(lines, policy)
        self.assertEqual(amounts.subtotal_minor, 20000)
        self.assertEqual(amounts.buyer_fee_minor, 500)
        self.assertEqual(amounts.total_minor, 20500)

    def test_seller_fee_is_accounted_per_line(self):
        policy = FeePolicy(version=1, buyer_fee_bps=0, seller_fee_bps=500)
        lines = [
            CartLine(uuid4(), uuid4(), 10001, 1, "EUR"),
            CartLine(uuid4(), uuid4(), 9999, 1, "EUR"),
        ]
        amounts = calculate_order_amounts(lines, policy)
        self.assertEqual(amounts.seller_fee_minor, 100)

    def test_mixed_currency_order_is_rejected(self):
        policy = FeePolicy(version=1, buyer_fee_bps=100, seller_fee_bps=100)
        lines = [
            CartLine(uuid4(), uuid4(), 100, 1, "EUR"),
            CartLine(uuid4(), uuid4(), 100, 1, "USD"),
        ]
        with self.assertRaises(ValueError):
            calculate_order_amounts(lines, policy)

    def test_empty_cart_is_rejected(self):
        with self.assertRaises(ValueError):
            calculate_order_amounts([], FeePolicy(1, 100, 100))


if __name__ == "__main__":
    unittest.main()
