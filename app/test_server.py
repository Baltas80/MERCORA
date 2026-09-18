import unittest

from fastapi import HTTPException
from fastapi.routing import APIRoute

import server


class ApiRouteTests(unittest.TestCase):
    def test_health_and_auth_routes_exist(self):
        paths = {
            route.path
            for route in server.app.routes
            if isinstance(route, APIRoute)
        }
        expected = {"/healthz", "/readyz", "/auth/register", "/auth/login", "/auth/me", "/auth/logout"}
        self.assertTrue(expected <= paths)

    def test_security_headers(self):
        from fastapi import Response

        response = Response()
        server.security_headers(response)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.headers["X-Frame-Options"], "DENY")
        self.assertEqual(response.headers["Referrer-Policy"], "no-referrer")

    def test_request_size_guard_rejects_oversized_body(self):
        class Headers:
            def get(self, name):
                if name == "content-length":
                    return str(server.MAX_REQUEST_BODY_BYTES + 1)
                return None

        class Request:
            headers = Headers()

        with self.assertRaises(HTTPException) as ctx:
            server.request_size_guard(Request())
        self.assertEqual(ctx.exception.status_code, 413)


if __name__ == "__main__":
    unittest.main()
