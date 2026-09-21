import http from "node:http";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = process.env.ADMIN_CONTROL_HOST ?? "127.0.0.1";
const PORT = Number(process.env.ADMIN_CONTROL_PORT ?? "8090");
const TOKEN = process.env.MERCORA_ADMIN_CONTROL_TOKEN ?? "";
const MERCORA_HOST = process.env.MERCORA_HOST ?? "127.0.0.1";
const MERCORA_PORT = Number(process.env.MERCORA_PORT ?? "8080");
const ONION_SERVICE_DIR = process.env.MERCORA_ONION_SERVICE_DIR ?? "/var/lib/tor/mercora";
const MAX_BODY = 8 * 1024;
const ACTION_TIMEOUT_MS = 30_000;

if (!TOKEN || TOKEN.length > 512 || /[\r\n]/.test(TOKEN)) {
  console.error("A valid MERCORA_ADMIN_CONTROL_TOKEN is required; refusing to start admin control API.");
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
  torValidate: ["scripts/tor-service-wsl.sh", "validate"],
  recover: null
});

const ACTION_MUTATIONS = new Set(["start", "stop", "restart", "torStart", "torStop", "torRestart", "recover"]);
let mutationInProgress = false;

function isLoopback(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function redactDiagnostics(value) {
  return String(value ?? "")
    .replace(/(MERCORA_ADMIN_CONTROL_TOKEN|POSTGRES_PASSWORD|DATABASE_URL)=\S+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}

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
    const definition = ACTIONS[action];
    if (!definition) return resolve({ ok: false, code: null, stdout: "", stderr: "unsupported_action" });

    const [script, command] = definition;
    const child = spawn("bash", [path.join(ROOT, script), command], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => finish({ ok: code === 0, code, stdout: redactDiagnostics(stdout.slice(-4000)), stderr: redactDiagnostics(stderr.slice(-4000)) }));
    child.on("error", (error) => finish({ ok: false, code: null, stdout: "", stderr: error.message }));

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, code: null, stdout: redactDiagnostics(stdout.slice(-4000)), stderr: redactDiagnostics(`${stderr.slice(-3500)}\noperation_timeout`) });
    }, ACTION_TIMEOUT_MS);
  });
}

async function checkHttp(pathname) {
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

async function checkStorage() {
  try {
    await fs.access(ROOT);
    return "online";
  } catch {
    return "offline";
  }
}

async function checkOnionConfigured() {
  try {
    await fs.access(path.join(ONION_SERVICE_DIR, "hostname"));
    return true;
  } catch {
    return false;
  }
}

async function collectStatus() {
  const [mercora, tor, health, postgresql, storage, onionConfigured] = await Promise.all([
    runAction("status"),
    runAction("torStatus"),
    checkHttp("/api/healthz"),
    checkPostgres(),
    checkStorage(),
    checkOnionConfigured()
  ]);

  return {
    service: "mercora-admin-control",
    mercora: mercora.ok ? "running" : "stopped",
    backend: health ? "online" : "offline",
    health: health ? "ok" : "error",
    tor: tor.ok ? "running" : "stopped",
    postgresql: postgresql ? "online" : "unknown",
    storage,
    // "configured" means Tor is running and a v3 service identity has been
    // provisioned. It does not prove reachability from another Tor client.
    onionService: tor.ok && onionConfigured ? "configured" : "offline"
  };
}

async function runRecovery() {
  const stages = [];

  const appBefore = await runAction("status");
  stages.push({ step: "mercora_status", ok: appBefore.ok, stdout: appBefore.stdout, stderr: appBefore.stderr });
  if (!appBefore.ok) {
    const appStart = await runAction("start");
    stages.push({ step: "mercora_start", ok: appStart.ok, stdout: appStart.stdout, stderr: appStart.stderr });
    if (!appStart.ok) return { ok: false, code: appStart.code, recovery: "failed", stages };
  }

  const torBefore = await runAction("torStatus");
  stages.push({ step: "tor_status", ok: torBefore.ok, stdout: torBefore.stdout, stderr: torBefore.stderr });
  if (!torBefore.ok) {
    const torStart = await runAction("torStart");
    stages.push({ step: "tor_start", ok: torStart.ok, stdout: torStart.stdout, stderr: torStart.stderr });
    if (!torStart.ok) return { ok: false, code: torStart.code, recovery: "failed", stages };
  }

  const status = await collectStatus();
  stages.push({ step: "final_status", ok: status.mercora === "running" && status.tor === "running" && status.backend === "online" && status.health === "ok" });
  return {
    ok: status.mercora === "running" && status.tor === "running" && status.backend === "online" && status.health === "ok",
    code: 0,
    recovery: "complete",
    status,
    stages
  };
}

async function runGuardedAction(action) {
  if (ACTION_MUTATIONS.has(action)) {
    if (mutationInProgress) return { ok: false, code: null, stdout: "", stderr: "another_mutating_action_is_in_progress" };
    mutationInProgress = true;
    try {
      return action === "recover" ? await runRecovery() : await runAction(action);
    } finally {
      mutationInProgress = false;
    }
  }
  return runAction(action);
}

const server = http.createServer(async (req, res) => {
  if (!isLoopback(req.socket.remoteAddress)) {
    return json(res, 403, { error: "local_only" });
  }
  if (!authorized(req)) return json(res, 401, { error: "unauthorized" });

  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

  if (req.method === "GET" && url.pathname === "/api/admin/status") {
    return json(res, 200, await collectStatus());
  }

  if (req.method === "POST" && url.pathname === "/api/admin/action") {
    const declaredLength = Number(req.headers["content-length"] ?? "0");
    if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_BODY) {
      return json(res, 413, { error: "body_too_large" });
    }

    let body = "";
    let rejected = false;
    req.setTimeout(5000, () => req.destroy());
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (Buffer.byteLength(body) > MAX_BODY) {
        rejected = true;
        req.destroy();
      }
    });
    req.on("error", () => {
      if (!res.headersSent) json(res, 400, { error: "request_aborted" });
    });
    req.on("end", async () => {
      if (rejected) return;
      try {
        const parsed = JSON.parse(body || "{}");
        const action = parsed.action;
        if (typeof action !== "string" || !Object.hasOwn(ACTIONS, action)) {
          return json(res, 400, { error: "unsupported_action" });
        }
        const result = await runGuardedAction(action);
        return json(res, result.ok ? 200 : 500, result);
      } catch {
        return json(res, 400, { error: "invalid_json" });
      }
    });
    return;
  }

  return json(res, 404, { error: "not_found" });
});

server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.listen(PORT, HOST, () => {
  console.log(`MERCORA Admin Control API listening on http://${HOST}:${PORT}`);
});
