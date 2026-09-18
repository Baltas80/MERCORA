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

    def request(self, path):
        conn = HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        conn.request("GET", path)
        response = conn.getresponse()
        body = response.read()
        conn.close()
        return response.status, json.loads(body)

    def test_health(self):
        self.assertEqual(self.request("/healthz"), (200, {"status": "ok"}))

    def test_readiness(self):
        self.assertEqual(self.request("/readyz"), (200, {"status": "ready"}))

    def test_unknown_path(self):
        self.assertEqual(self.request("/unknown"), (404, {"error": "not_found"}))


if __name__ == "__main__":
    unittest.main()
