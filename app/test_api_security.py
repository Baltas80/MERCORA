import unittest

from fastapi import Response

import server


class ApiSecurityTests(unittest.TestCase):
    def test_required_auth_routes_exist(self):
        paths = {route.path for route in server.app.routes}
        self.assertTrue({"/healthz", "/readyz", "/auth/register", "/auth/login", "/auth/me", "/auth/logout"} <= paths)

    def test_session_and_csrf_cookies_have_expected_flags(self):
        response = Response()
        original = server.COOKIE_SECURE
        try:
            server.COOKIE_SECURE = True
            server.set_auth_cookies(response, "session-token", "csrf-token")
        finally:
            server.COOKIE_SECURE = original

        headers = [value for key, value in response.raw_headers if key.lower() == b"set-cookie"]
        joined = "\n".join(value.decode("latin-1") for value in headers)
        self.assertIn("mercora_session=session-token", joined)
        self.assertIn("HttpOnly", joined)
        self.assertIn("Secure", joined)
        self.assertIn("SameSite=strict", joined)
        self.assertIn("mercora_csrf=csrf-token", joined)

    def test_security_headers_are_applied(self):
        response = Response()
        server.security_headers(response)
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.headers["X-Frame-Options"], "DENY")
        self.assertEqual(response.headers["Referrer-Policy"], "no-referrer")

    def test_request_size_guard_rejects_oversized_content_length(self):
        class FakeHeaders:
            def get(self, name):
                return str(server.MAX_REQUEST_BODY_BYTES + 1) if name == "content-length" else None

        class FakeRequest:
            headers = FakeHeaders()

        with self.assertRaises(Exception):
            server.request_size_guard(FakeRequest())


if __name__ == "__main__":
    unittest.main()
