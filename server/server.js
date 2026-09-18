import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "web");
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? "8080");

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const buckets = new Map();

function securityHeaders() {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'"
    ].join("; "),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cache-Control": "no-store"
  };
}

function clientKey(req) {
  return req.socket.remoteAddress ?? "local";
}

function rateAllowed(key) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || now - current.start >= WINDOW_MS) {
    buckets.set(key, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= MAX_REQUESTS;
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8"
  });
  return res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  for (const [name, value] of Object.entries(securityHeaders())) res.setHeader(name, value);

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }

  if (!rateAllowed(clientKey(req))) {
    res.writeHead(429, { "Retry-After": "60" });
    return res.end("Too Many Requests");
  }

  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/api/healthz") {
    return sendJson(res, 200, { status: "ok" });
  }

  if (url.pathname === "/api/version") {
    return sendJson(res, 200, { service: "mercora", api: "v1" });
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;

  if (requested.includes("..") || requested.includes("\\") || requested.includes("%")) {
    res.writeHead(400);
    return res.end("Bad Request");
  }

  const file = path.resolve(PUBLIC, "." + requested);
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(400);
    return res.end("Bad Request");
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": contentType(file) });
    if (req.method === "HEAD") return res.end();
    return res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not Found");
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.start >= WINDOW_MS * 2) buckets.delete(key);
  }
}, WINDOW_MS).unref();

server.listen(PORT, HOST, () => {
  console.log(`MERCORA listening on http://${HOST}:${PORT}`);
});
