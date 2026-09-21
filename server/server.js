import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicData } from "./public-data.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "web");
const RUNTIME_CONFIG = path.join(ROOT, "runtime", "site-config.json");
const DEFAULT_SITE_CONFIG = Object.freeze({
  site_name: "MERCORA",
  site_mode: "public",
  announcement: "",
  maintenance_message: "",
  new_listings_enabled: "true",
  seller_registration_enabled: "true",
  footer_notice: "",
  hero_title: "Buy. Sell. Keep control.",
  hero_copy: "A second-hand marketplace built around privacy, strong security boundaries and a clean buying experience.",
  buy_cta: "Browse listings",
  sell_cta: "List an item"
});
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? "8080");
const publicData = createPublicData();

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_SOCKET = 120;
const MAX_REQUESTS_GLOBAL = 2_000;
const socketBuckets = new WeakMap();
let globalBucket = { start: Date.now(), count: 0 };

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

function rateAllowed(socket) {
  const now = Date.now();
  if (now - globalBucket.start >= WINDOW_MS) globalBucket = { start: now, count: 0 };
  globalBucket.count += 1;
  if (globalBucket.count > MAX_REQUESTS_GLOBAL) return false;

  const current = socketBuckets.get(socket);
  if (!current || now - current.start >= WINDOW_MS) {
    socketBuckets.set(socket, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= MAX_REQUESTS_PER_SOCKET;
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  return res.end(JSON.stringify(payload));
}

async function fileConfig() {
  try {
    const parsed = JSON.parse(await readFile(RUNTIME_CONFIG, "utf8"));
    const config = {};
    for (const key of Object.keys(DEFAULT_SITE_CONFIG)) {
      config[key] = typeof parsed[key] === "string" ? parsed[key] : DEFAULT_SITE_CONFIG[key];
    }
    if (!["public", "maintenance", "restricted"].includes(config.site_mode)) config.site_mode = DEFAULT_SITE_CONFIG.site_mode;
    for (const key of ["new_listings_enabled", "seller_registration_enabled"]) {
      if (config[key] !== "true" && config[key] !== "false") config[key] = DEFAULT_SITE_CONFIG[key];
    }
    return config;
  } catch {
    return { ...DEFAULT_SITE_CONFIG };
  }
}

async function runtimeConfig() {
  try {
    const config = await publicData.siteConfig();
    return { ...DEFAULT_SITE_CONFIG, ...config };
  } catch {
    return fileConfig();
  }
}

function publicError(error, fallback) {
  const message = String(error?.message || fallback);
  return message.length > 300 ? message.slice(0, 300) : message;
}

const server = http.createServer(async (req, res) => {
  for (const [name, value] of Object.entries(securityHeaders())) res.setHeader(name, value);

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }

  if (!rateAllowed(req.socket)) {
    res.writeHead(429, { "Retry-After": "60" });
    return res.end("Too Many Requests");
  }

  const url = new URL(req.url ?? "/", "http://localhost");

  try {
    if (url.pathname === "/api/healthz") return sendJson(res, 200, { status: "ok" });
    if (url.pathname === "/api/version") return sendJson(res, 200, { service: "mercora", api: "v1" });

    if (url.pathname === "/api/site-config") {
      return sendJson(res, 200, await runtimeConfig());
    }

    if (url.pathname === "/api/categories") {
      return sendJson(res, 200, { categories: await publicData.categories() });
    }

    if (url.pathname === "/api/listings") {
      const q = url.searchParams.get("q") ?? "";
      const category = url.searchParams.get("category") ?? "";
      const limit = url.searchParams.get("limit") ?? undefined;
      const offset = url.searchParams.get("offset") ?? undefined;
      const listings = await publicData.listings({ q, category, limit, offset });
      return sendJson(res, 200, {
        listings,
        pagination: {
          limit: Number(limit ?? 24),
          offset: Number(offset ?? 0),
          returned: listings.length
        }
      });
    }

    if (url.pathname.startsWith("/api/sellers/")) {
      const rawName = url.pathname.slice("/api/sellers/".length);
      if (!rawName) return sendJson(res, 404, { error: "seller not found" });
      const seller = await publicData.seller(decodeURIComponent(rawName));
      if (!seller) return sendJson(res, 404, { error: "seller not found" });
      return sendJson(res, 200, seller);
    }
  } catch (error) {
    const status = /invalid|too long|format/i.test(String(error?.message || "")) ? 400 : 503;
    return sendJson(res, status, { error: publicError(error, "public API unavailable") });
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

server.listen(PORT, HOST, () => {
  console.log(`MERCORA listening on http://${HOST}:${PORT}`);
});
