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

    def test_normal_operating_state_opens_only_with_explicit_runtime_enable(self):
        previous = os.environ.get("MERCORA_REAL_FUNDS_ENABLED")
        try:
            os.environ["MERCORA_REAL_FUNDS_ENABLED"] = "true"
            import security
            security.REAL_FUNDS_ENABLED = True
            self.assertTrue(financial_open(_Cursor([["normal"], ["normal"]])))
        finally:
            if previous is None:
                os.environ.pop("MERCORA_REAL_FUNDS_ENABLED", None)
            else:
                os.environ["MERCORA_REAL_FUNDS_ENABLED"] = previous
            import security
            security.REAL_FUNDS_ENABLED = previous == "true"


if __name__ == "__main__":
    unittest.main()
