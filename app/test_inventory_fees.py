import unittest
from uuid import uuid4

from fees import FeePolicy, calculate_fees, calculate_percentage_fee
from inventory import ReservationResult, commit_inventory_sale, release_inventory, reserve_inventory


class FakeCursor:
    def __init__(self, rows=None, rowcount=1):
        self.rows = list(rows or [])
        self.executed = []
        self.rowcount = rowcount

    def execute(self, sql, params=()):
        self.executed.append((sql, params))

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None


class InventoryTests(unittest.TestCase):
    def test_reservation_requires_positive_quantity(self):
        with self.assertRaises(ValueError):
            reserve_inventory(FakeCursor([(10,)]), uuid4(), 0)

    def test_reservation_locks_inventory_row(self):
        cur = FakeCursor([(10,)])
        result = reserve_inventory(cur, uuid4(), 3)
        self.assertEqual(result, ReservationResult.RESERVED)
        self.assertIn("FOR UPDATE", cur.executed[0][0])

    def test_insufficient_stock_does_not_update(self):
        cur = FakeCursor([(2,)])
        result = reserve_inventory(cur, uuid4(), 3)
        self.assertEqual(result, ReservationResult.INSUFFICIENT_STOCK)
        self.assertEqual(len(cur.executed), 1)

    def test_release_requires_database_invariant(self):
        cur = FakeCursor(rowcount=0)
        with self.assertRaises(ValueError):
            release_inventory(cur, uuid4(), 1)

    def test_sale_commit_requires_reserved_quantity(self):
        cur = FakeCursor(rowcount=0)
        with self.assertRaises(ValueError):
            commit_inventory_sale(cur, uuid4(), 1)


class FeeTests(unittest.TestCase):
    def test_percentage_fee_uses_integer_minor_units(self):
        self.assertEqual(calculate_percentage_fee(10000, 250), 250)
        self.assertEqual(calculate_percentage_fee(101, 1), 1)

    def test_fee_policy_is_bounded(self):
        with self.assertRaises(ValueError):
            FeePolicy(1, 7500, 3000)

    def test_buyer_and_seller_fees_are_independent(self):
        policy = FeePolicy(version=7, buyer_fee_bps=250, seller_fee_bps=500)
        result = calculate_fees(10000, policy)
        self.assertEqual(result.buyer_fee_minor, 250)
        self.assertEqual(result.seller_fee_minor, 500)

    def test_zero_fee_is_supported(self):
        policy = FeePolicy(version=1, buyer_fee_bps=0, seller_fee_bps=0)
        self.assertEqual(calculate_fees(999, policy).buyer_fee_minor, 0)


if __name__ == "__main__":
    unittest.main()
