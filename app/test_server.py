import json
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

from server import Handler


class HealthEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def request(self, path, headers=None):
        conn = HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        conn.request("GET", path, headers=headers or {})
        response = conn.getresponse()
        body = response.read()
        result = (response.status, json.loads(body), dict(response.getheaders()))
        conn.close()
        return result

    def test_health(self):
        status, body, headers = self.request("/healthz")
        self.assertEqual((status, body), (200, {"status": "ok"}))
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(headers["X-Frame-Options"], "DENY")

    def test_readiness(self):
        status, body, _ = self.request("/readyz")
        self.assertEqual((status, body), (200, {"status": "ready"}))

    def test_unknown_path(self):
        status, body, _ = self.request("/unknown")
        self.assertEqual((status, body), (404, {"error": "not_found"}))


if __name__ == "__main__":
    unittest.main()
