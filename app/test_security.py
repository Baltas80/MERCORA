import os
import sys
import unittest
from uuid import UUID

sys.path.insert(0, os.path.dirname(__file__))

from security import financial_open

class _Cursor:
    def __init__(self, values):
        self.values = iter(values)
        self.current = None

    def execute(self, query, params=()):
        self.current = next(self.values)

    def fetchone(self):
        return self.current


class FinancialGateTests(unittest.TestCase):
    def test_missing_operating_state_fails_closed(self):
        self.assertFalse(financial_open(_Cursor([None, None])))

    def test_unexpected_operating_state_fails_closed(self):
        self.assertFalse(financial_open(_Cursor([["normal"], ["emergency"]])))

    def test_normal_operating_state_opens(self):
        self.assertTrue(financial_open(_Cursor([["normal"], ["normal"]])))


if __name__ == "__main__":
    unittest.main()
