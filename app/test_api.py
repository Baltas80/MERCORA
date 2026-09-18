import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient

from api import CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, app
from auth import AuthenticatedAccount


class ApiSecurityTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.account = AuthenticatedAccount(uuid4(), "seller-01", "seller")

    def test_health_does_not_expose_framework_docs(self):
        response = self.client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.headers["X-Frame-Options"], "DENY")
        self.assertEqual(self.client.get("/docs").status_code, 404)

    @patch("api.connection")
    def test_login_sets_secure_http_only_strict_session_cookie(self, connection):
        class Cursor:
            def execute(self, *args):
                pass
            def fetchone(self):
                return None
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False

        class Conn:
            def cursor(self):
                return Cursor()
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False

        connection.return_value = Conn()
        with patch("api.authenticate_account", return_value=self.account), patch("api.create_session", return_value="s" * 43):
            response = self.client.post("/auth/login", json={"pseudonym": "seller-01", "password": "correct password"})
        self.assertEqual(response.status_code, 200)
        set_cookie = response.headers["set-cookie"]
        self.assertIn(f"{SESSION_COOKIE}=", set_cookie)
        self.assertIn("HttpOnly", set_cookie)
        self.assertIn("Secure", set_cookie)
        self.assertIn("SameSite=strict", set_cookie)
        self.assertIn(f"{CSRF_COOKIE}=", set_cookie)

    def test_logout_requires_csrf_when_session_exists(self):
        self.client.cookies.set(SESSION_COOKIE, "x" * 43)
        response = self.client.post("/auth/logout")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {"error": "csrf_failed"})

    def test_rate_limit_is_bounded(self):
        from rate_limit import LoginRateLimiter
        limiter = LoginRateLimiter(max_attempts=2, window_seconds=60, max_keys=2)
        self.assertTrue(limiter.allow("account"))
        self.assertTrue(limiter.allow("account"))
        self.assertFalse(limiter.allow("account"))
        self.assertTrue(limiter.allow("other"))
        self.assertTrue(limiter.allow("third"))


if __name__ == "__main__":
    unittest.main()
