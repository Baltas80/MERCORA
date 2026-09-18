import unittest
from uuid import UUID, uuid4

from auth import (
    AuthenticatedAccount,
    _token_hash,
    authenticate_account,
    create_session,
    new_session_token,
    validate_password,
    validate_pseudonym,
)


class FakeCursor:
    def __init__(self, row=None):
        self.row = row
        self.executed = []
        self._fetch = row

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=()):
        self.executed.append((sql, params))

    def fetchone(self):
        return self._fetch


class FakeConnection:
    def __init__(self, row=None):
        self.cursor_obj = FakeCursor(row)

    def cursor(self):
        return self.cursor_obj


class AuthCoreTests(unittest.TestCase):
    def test_pseudonym_validation(self):
        self.assertEqual(validate_pseudonym("Seller_01"), "Seller_01")
        for value in ("ab", " bad", "bad name", "../admin", "a" * 33):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    validate_pseudonym(value)

    def test_password_length_is_bounded(self):
        with self.assertRaises(ValueError):
            validate_password("x" * 1025)

    def test_session_token_is_high_entropy_and_only_hash_is_persisted(self):
        token = new_session_token()
        self.assertGreaterEqual(len(token), 40)
        self.assertNotEqual(token.encode(), _token_hash(token))

    def test_authentication_requires_active_account_and_correct_password(self):
        from passwords import hash_password
        account_id = uuid4()
        row = (account_id, "seller-01", hash_password("correct password"), "seller", "active")
        conn = FakeConnection(row)
        account = authenticate_account(conn, "SELLER-01", "correct password")
        self.assertIsInstance(account, AuthenticatedAccount)
        self.assertEqual(account.id, account_id)
        self.assertEqual(account.role, "seller")
        self.assertIsNone(authenticate_account(conn, "SELLER-01", "wrong password"))

    def test_create_session_persists_hash_not_raw_token(self):
        account_id = UUID("11111111-1111-1111-1111-111111111111")
        conn = FakeConnection()
        token = create_session(conn, account_id, ttl_seconds=60)
        self.assertTrue(token)
        sql, params = conn.cursor_obj.executed[-1]
        self.assertIn("INSERT INTO sessions", sql)
        self.assertEqual(params[1], account_id)
        self.assertEqual(len(params[2]), 32)
        self.assertNotEqual(params[2].hex(), token)


if __name__ == "__main__":
    unittest.main()
