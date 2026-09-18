import unittest
from uuid import UUID, uuid4

from checkout import reserve_cart
from orders import CartLine


class FakeCursor:
    def __init__(self, available_values):
        self.available_values = list(available_values)
        self.executed = []
        self.rowcount = 1

    def execute(self, sql, params=()):
        self.executed.append((sql, params))

    def fetchone(self):
        if self.executed and "SELECT available_quantity" in self.executed[-1][0]:
            return (self.available_values.pop(0),)
        return None


class CheckoutTests(unittest.TestCase):
    def test_cart_lines_are_locked_in_deterministic_listing_order(self):
        first = UUID("00000000-0000-0000-0000-000000000001")
        second = UUID("00000000-0000-0000-0000-000000000002")
        cur = FakeCursor([10, 10])
        lines = [
            CartLine(second, uuid4(), 100, 1, "EUR"),
            CartLine(first, uuid4(), 100, 1, "EUR"),
        ]

        result = reserve_cart(cur, lines)

        self.assertEqual(result.reserved_lines, 2)
        lock_queries = [
            params[0]
            for sql, params in cur.executed
            if "SELECT available_quantity" in sql
        ]
        self.assertEqual(lock_queries, [first, second])

    def test_insufficient_stock_aborts_reservation(self):
        cur = FakeCursor([0])
        with self.assertRaises(ValueError):
            reserve_cart(
                cur,
                [CartLine(uuid4(), uuid4(), 100, 1, "EUR")],
            )


if __name__ == "__main__":
    unittest.main()
