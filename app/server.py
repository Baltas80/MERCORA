from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8080"))


class Handler(BaseHTTPRequestHandler):
    server_version = "MERCORA/0"
    sys_version = ""

    def _send(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            self._send(200, b'{"status":"ok"}\n')
            return
        if self.path == "/readyz":
            self._send(200, b'{"status":"ready"}\n')
            return
        self._send(404, b'{"error":"not_found"}\n')

    def log_message(self, format: str, *args: object) -> None:
        # Avoid default access logs because request metadata should not be
        # retained by the application unless an explicit logging policy exists.
        return


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
