import http from "node:http";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = process.env.ADMIN_CONTROL_HOST ?? "127.0.0.1";
const PORT = Number(process.env.ADMIN_CONTROL_PORT ?? "8090");
const TOKEN = process.env.MERCORA_ADMIN_CONTROL_TOKEN ?? "";
const MERCORA_HOST = process.env.MERCORA_HOST ?? "127.0.0.1";
const MERCORA_PORT = Number(process.env.MERCORA_PORT ?? "8080");
const MAX_BODY = 8 * 1024;

if (!TOKEN) {
  console.error("MERCORA_ADMIN_CONTROL_TOKEN is required; refusing to start admin control API.");
  process.exit(1);
}

const ACTIONS = Object.freeze({
  start: ["scripts/mercora-service.sh", "start"],
  stop: ["scripts/mercora-service.sh", "stop"],
  restart: ["scripts/mercora-service.sh", "restart"],
  status: ["scripts/mercora-service.sh", "status"],
  health: ["scripts/mercora-service.sh", "health"],
  torStart: ["scripts/tor-service-wsl.sh", "start"],
  torStop: ["scripts/tor-service-wsl.sh", "stop"],
  torRestart: ["scripts/tor-service-wsl.sh", "restart"],
  torStatus: ["scripts/tor-service-wsl.sh", "status"],
  torValidate: ["scripts/tor-service-wsl.sh", "validate"]
});

function authorized(req) {
  const header = req.headers.authorization ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const supplied = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(TOKEN);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'"
  });
  res.end(JSON.stringify(payload));
}

function runAction(action) {
  return new Promise((resolve) => {
    const [script, command] = ACTIONS[action];
    const child = spawn("bash", [path.join(ROOT, script), command], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ ok: code === 0, code, stdout: stdout.slice(-4000), stderr: stderr.slice(-4000) }));
    child.on("error", (error) => resolve({ ok: false, code: null, stdout: "", stderr: error.message }));
  });
}

function checkHttp(pathname) {
  return new Promise((resolve) => {
    const request = http.get({ hostname: MERCORA_HOST, port: MERCORA_PORT, path: pathname, timeout: 2500 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

function checkPostgres() {
  return new Promise((resolve) => {
    const child = spawn("pg_isready", [], { stdio: ["ignore", "ignore", "ignore"] });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.socket.remoteAddress !== "127.0.0.1" && req.socket.remoteAddress !== "::1") {
    return json(res, 403, { error: "local_only" });
  }
  if (!authorized(req)) return json(res, 401, { error: "unauthorized" });

  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

  if (req.method === "GET" && url.pathname === "/api/admin/status") {
    const [mercora, tor, health, postgresql] = await Promise.all([
      runAction("status"),
      runAction("torStatus"),
      checkHttp("/api/healthz"),
      checkPostgres()
    ]);
    return json(res, 200, {
      service: "mercora-admin-control",
      mercora: mercora.ok ? "running" : "stopped",
      backend: health ? "online" : "offline",
      health: health ? "ok" : "error",
      tor: tor.ok ? "running" : "stopped",
      postgresql: postgresql ? "online" : "unknown",
      storage: "online",
      onionService: tor.ok ? "running" : "unknown"
    });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/action") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const action = parsed.action;
        if (typeof action !== "string" || !Object.hasOwn(ACTIONS, action)) {
          return json(res, 400, { error: "unsupported_action" });
        }
        const result = await runAction(action);
        return json(res, result.ok ? 200 : 500, result);
      } catch {
        return json(res, 400, { error: "invalid_json" });
      }
    });
    return;
  }

  return json(res, 404, { error: "not_found" });
});

server.listen(PORT, HOST, () => {
  console.log(`MERCORA Admin Control API listening on http://${HOST}:${PORT}`);
});
