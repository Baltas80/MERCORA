from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8080"))
MAX_REQUEST_BODY_BYTES = 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    server_version = "MERCORA"
    sys_version = ""

    def _send(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=()")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.end_headers()
        self.wfile.write(body)

    def _reject_oversized_body(self) -> bool:
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            return False
        try:
            length = int(raw_length)
        except ValueError:
            self._send(400, b'{"error":"invalid_content_length"}\n')
            return True
        if length < 0 or length > MAX_REQUEST_BODY_BYTES:
            self._send(413, b'{"error":"request_too_large"}\n')
            return True
        return False

    def send_error(self, code, message=None, explain=None):
        body = b'{"error":"http_error"}\n'
        self._send(code, body)

    def do_GET(self) -> None:  # noqa: N802
        if self._reject_oversized_body():
            return
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
