import unittest
from uuid import uuid4

from auth import new_session_token, revoke_all_sessions, revoke_session, touch_session


class FakeCursor:
    def __init__(self, rowcount=0):
        self.executed = []
        self.rowcount = rowcount

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=()):
        self.executed.append((sql, params))


class FakeConnection:
    def __init__(self, rowcount=0):
        self.cursor_obj = FakeCursor(rowcount)

    def cursor(self):
        return self.cursor_obj


class SessionHardeningTests(unittest.TestCase):
    def test_touch_updates_activity_without_sliding_expiry(self):
        conn = FakeConnection()
        touch_session(conn, new_session_token())
        sql, _ = conn.cursor_obj.executed[-1]
        self.assertIn("SET last_seen_at = now()", sql)
        self.assertNotIn("expires_at =", sql)

    def test_revoke_session_is_scoped_to_active_session(self):
        conn = FakeConnection()
        revoke_session(conn, new_session_token())
        sql, _ = conn.cursor_obj.executed[-1]
        self.assertIn("SET revoked_at = now()", sql)
        self.assertIn("revoked_at IS NULL", sql)

    def test_revoke_all_sessions_only_targets_unexpired_sessions(self):
        account_id = uuid4()
        conn = FakeConnection(rowcount=3)
        self.assertEqual(revoke_all_sessions(conn, account_id), 3)
        sql, params = conn.cursor_obj.executed[-1]
        self.assertIn("UPDATE sessions", sql)
        self.assertIn("revoked_at IS NULL", sql)
        self.assertIn("expires_at > now()", sql)
        self.assertEqual(params, (account_id,))


if __name__ == "__main__":
    unittest.main()
