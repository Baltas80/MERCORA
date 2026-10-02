import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ACTIONS = Object.freeze([
  'START', 'STOP', 'RESTART', 'STATUS', 'HEALTH_CHECK', 'RECOVER'
]);

const COMPOSE_BASE = Object.freeze(['compose', '-f', 'docker-compose.yml']);
const ONION_COMPOSE = 'docker-compose.onion.yml';
const ALLOWED_SERVICES = new Set(['app', 'postgres', 'tor']);
const REQUIRED_SERVICES = Object.freeze(['app', 'postgres', 'tor']);
const BACKEND_CONTAINER_PORT = '8080';
const BACKEND_HEALTH_PATH = '/api/healthz';
const BACKEND_HEALTH_COMMAND = Object.freeze([
  'node',
  '-e',
  `fetch('http://127.0.0.1:${BACKEND_CONTAINER_PORT}${BACKEND_HEALTH_PATH}').then(async (response) => { console.log(JSON.stringify({ status: response.status, statusText: response.statusText, ok: response.ok })); process.exit(response.ok ? 0 : 1); }).catch((error) => { console.error(`${error.name}: ${error.message}${error.cause?.code ? ` (${error.cause.code})` : ''}`); process.exit(1); })`
]);
const SENSITIVE_LINE = /^\s*(password|secret|token|seed|private.?key|mnemonic|authorization)\s*[:=]/i;
const CREDENTIAL_URL = /([a-z][a-z\d+.-]*:\/\/[^\s:/@]+:)[^\s/@]+(@)/gi;
const INLINE_SECRET = /((?:password|secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*)[^\s,;]+/gi;

function cleanDiagnostic(text = '') {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => !SENSITIVE_LINE.test(line))
    .map((line) => line.replace(CREDENTIAL_URL, '$1[REDACTED]$2').replace(INLINE_SECRET, '$1[REDACTED]'))
    .join('\n')
    .slice(0, 4000);
}

export function sanitizeResult(result) {
  return {
    ok: Boolean(result?.ok),
    code: Number.isInteger(result?.code) ? result.code : null,
    stdout: cleanDiagnostic(result?.stdout),
    stderr: cleanDiagnostic(result?.stderr)
  };
}

function composeFiles(action, service) {
  if (service === 'tor' || action === 'STATUS' || action === 'HEALTH_CHECK' || service === undefined) {
    return [...COMPOSE_BASE, '-f', ONION_COMPOSE];
  }
  return COMPOSE_BASE;
}

function composeArgs(action, service) {
  if (!ACTIONS.includes(action)) throw new Error('Unsupported admin action');
  if (service !== undefined && !ALLOWED_SERVICES.has(service)) throw new Error('Unsupported service');
  const files = composeFiles(action, service);
  switch (action) {
    case 'START': return [...files, 'up', '-d', ...(service ? [service] : [])];
    case 'STOP': return [...files, 'stop', ...(service ? [service] : [])];
    case 'RESTART': return [...files, 'restart', ...(service ? [service] : [])];
    case 'STATUS': return [...files, 'ps'];
    case 'HEALTH_CHECK': return [...files, 'ps'];
    default: return null;
  }
}

function state(ok, positive = 'ONLINE') { return ok ? positive : 'OFFLINE'; }

function serviceRunning(stdout = '', service) {
  const actual = new Set(String(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  return actual.has(service);
}

function allServicesRunning(stdout = '') {
  return REQUIRED_SERVICES.every((service) => serviceRunning(stdout, service));
}

function hasNonEmptyEnvAssignment(content, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(content).match(new RegExp(`^\\s*${escaped}\\s*=\\s*(.*?)\\s*$`, 'm'));
  if (!match) return false;
  const value = match[1].trim();
  return value.length > 0 && value !== '\"\"' && value !== "''";
}

function configurationCheck(cwd = process.cwd()) {
  if (typeof process.env.POSTGRES_PASSWORD === 'string' && process.env.POSTGRES_PASSWORD.length > 0) {
    return {
      name: 'configuration',
      ok: true,
      code: 0,
      stdout: 'required compose configuration detected',
      stderr: ''
    };
  }

  try {
    const envFile = fs.readFileSync(path.join(cwd, '.env'), 'utf8');
    if (hasNonEmptyEnvAssignment(envFile, 'POSTGRES_PASSWORD')) {
      return {
        name: 'configuration',
        ok: true,
        code: 0,
        stdout: 'required compose configuration detected',
        stderr: ''
      };
    }
  } catch {
    // Missing or unreadable .env is handled as missing configuration below.
  }

  return {
    name: 'configuration',
    ok: false,
    code: null,
    stdout: '',
    stderr: 'POSTGRES_PASSWORD is not configured for Docker Compose'
  };
}

export { configurationCheck };

export function createAdminController({ cwd = path.resolve(process.cwd()), runner = defaultRunner, probe = defaultProbe, backendProbeFn, configurationProbe } = {}) {
  const configurationProbeFn = configurationProbe ?? (() => configurationCheck(cwd));
  const backendProbeFnActual = backendProbeFn ?? (() => backendProbe(runner, cwd));

  async function run(action, service) {
    if (action === 'STATUS') return status();
    if (action === 'HEALTH_CHECK') return healthCheck();
    const args = composeArgs(action, service);
    if (args) return sanitizeResult(await runner('docker', args, { cwd }));
    if (action === 'RECOVER') return recover(service);
    throw new Error('Unsupported admin action');
  }

  async function status() {
    const health = await healthCheck();
    const checks = Object.fromEntries(health.checks.map((check) => [check.name, check]));
    return {
      ok: health.ok,
      mercora: state(checks.services?.ok && checks.backend?.ok && checks.postgresql?.ok && checks.onionService?.ok),
      node: state(checks.node?.ok),
      postgresql: state(checks.postgresql?.ok),
      backend: state(checks.backend?.ok),
      tor: state(checks.services?.torRunning && checks.torConfig?.ok && checks.onionService?.ok),
      onionService: state(checks.onionService?.ok, 'CONFIGURED'),
      storage: state(checks.storage?.ok, 'OK'),
      health: state(health.ok, 'OK'),
      platform: health.platform
    };
  }

  async function recover(service) {
    if (service !== undefined && !ALLOWED_SERVICES.has(service)) throw new Error('Unsupported service');

    const configuration = configurationProbeFn();
    if (!configuration.ok) {
      return {
        ok: false,
        target: null,
        targetHealthy: false,
        repaired: false,
        blocked: true,
        steps: [{ step: 'configuration', result: sanitizeResult(configuration) }]
      };
    }

    let target = service;
    const steps = [];
    const diagnosis = await healthCheck();

    if (target === undefined) {
      steps.push({ step: 'diagnosis', result: diagnosis });
      target = selectRecoveryTarget(diagnosis);
      if (target === null) {
        return { ok: diagnosis.ok, target: null, targetHealthy: diagnosis.ok, repaired: false, steps };
      }
    } else {
      steps.push({ step: 'dependency-check', result: diagnosis });
      const dependencyFailure = dependencyFailureForTarget(diagnosis, target);
      if (dependencyFailure) {
        steps.push({ step: 'dependency-block', result: dependencyFailure });
        return {
          ok: false,
          target,
          targetHealthy: false,
          repaired: false,
          blocked: true,
          steps
        };
      }
    }

    const restart = await run('RESTART', target);
    steps.push({ step: `restart:${target}`, result: restart });
    let repaired = restart.ok;
    if (!restart.ok) {
      const start = await run('START', target);
      steps.push({ step: `start:${target}`, result: start });
      repaired = start.ok;
    }

    // Recovery verification is deliberately exposed as ordered, sanitized
    // checkpoints. This prevents the UI from treating one aggregate health
    // result as proof that every required dependency was revalidated.
    const verification = await healthCheck();
    appendRecoveryVerificationSteps(steps, verification);
    const targetHealthy = targetHealthyFromChecks(verification, target);
    const finalHealth = { ok: verification.ok, checks: verification.checks, platform: verification.platform };
    steps.push({ step: 'health', result: finalHealth });
    return { ok: repaired && targetHealthy && verification.ok, target, targetHealthy, repaired, steps };
  }

  async function healthCheck() {
    const checks = [];
    checks.push(sanitizeResult(configurationProbeFn()));
    checks[0].name = 'configuration';
    checks.push(named('node', await probe('node', ['--version'], { cwd })));
    checks.push(named('docker', await probe('docker', ['version', '--format', '{{.Server.Version}}'], { cwd })));
    checks.push(named('backend', await backendProbeFnActual()));
    checks.push(named('postgresql', await runner('docker', [...COMPOSE_BASE, '-f', ONION_COMPOSE, 'exec', '-T', 'postgres', 'pg_isready', '-U', 'mercora', '-d', 'mercora'], { cwd })));

    const composeServices = await runner('docker', [...COMPOSE_BASE, '-f', ONION_COMPOSE, 'ps', '--status', 'running', '--services'], { cwd });
    checks.push({
      name: 'services',
      ...sanitizeResult(composeServices),
      appRunning: Boolean(composeServices?.ok) && serviceRunning(composeServices?.stdout, 'app'),
      postgresRunning: Boolean(composeServices?.ok) && serviceRunning(composeServices?.stdout, 'postgres'),
      torRunning: Boolean(composeServices?.ok) && serviceRunning(composeServices?.stdout, 'tor')
    });
    checks.at(-1).ok = checks.at(-1).ok && allServicesRunning(composeServices?.stdout);

    // Check the actual Tor configuration file used by the Onion Service.
    // Do not inspect image defaults: those defaults may contain relay listeners
    // that are intentionally overridden by MERCORA's service configuration.
    const torConfigProbe = await runner('docker', [...COMPOSE_BASE, '-f', ONION_COMPOSE, 'exec', '-T', 'tor', 'grep', '-E', '^(ORPort|DirPort|ExitPolicy)[[:space:]]+', '/data/torrc'], { cwd });
    const torConfig = sanitizeResult(torConfigProbe);
    const torConfigLines = String(torConfigProbe?.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const torConfigValues = Object.fromEntries(torConfigLines.map((line) => line.split(/\s+/, 2)));
    checks.push({
      name: 'torConfig',
      ...torConfig,
      ok: torConfig.ok && torConfigValues.ORPort === '0' && torConfigValues.DirPort === '0' && torConfigLines.some((line) => line === 'ExitPolicy reject *:*')
    });

    checks.push(named('onionService', await runner('docker', [...COMPOSE_BASE, '-f', ONION_COMPOSE, 'exec', '-T', 'tor', 'test', '-s', '/data/mercora/hostname'], { cwd })));

    const volumes = await runner('docker', [...COMPOSE_BASE, '-f', ONION_COMPOSE, 'config', '--volumes'], { cwd });
    const volumeCheck = sanitizeResult(volumes);
    const definedVolumes = new Set(String(volumes?.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    checks.push({
      name: 'storage',
      ...volumeCheck,
      ok: volumeCheck.ok && definedVolumes.has('postgres_data'),
      stdout: volumeCheck.ok ? 'postgres_data configured' : volumeCheck.stdout
    });

    return { ok: checks.every((item) => item.ok), checks, platform: os.platform() };
  }

  return Object.freeze({ run, healthCheck, status });
}

function appendRecoveryVerificationSteps(steps, health) {
  const checks = Object.fromEntries(health.checks.map((check) => [check.name, check]));
  const dependencyOk = Boolean(checks.configuration?.ok && checks.docker?.ok && checks.node?.ok && checks.services?.ok);
  steps.push({
    step: 'verify:dependencies',
    result: { ok: dependencyOk, configuration: checks.configuration, node: checks.node, docker: checks.docker, services: checks.services }
  });
  steps.push({ step: 'verify:backend', result: checks.backend ?? { ok: false, stderr: 'backend check unavailable' } });
  steps.push({ step: 'verify:database', result: checks.postgresql ?? { ok: false, stderr: 'database check unavailable' } });
  steps.push({
    step: 'verify:tor',
    result: {
      ok: Boolean(checks.services?.torRunning && checks.torConfig?.ok),
      services: checks.services ?? null,
      torConfig: checks.torConfig ?? null
    }
  });
  steps.push({ step: 'verify:onion-service', result: checks.onionService ?? { ok: false, stderr: 'onion service check unavailable' } });
}

function named(name, result) { return { name, ...sanitizeResult(result) }; }

function selectRecoveryTarget(health) {
  const checks = Object.fromEntries(health.checks.map((check) => [check.name, check]));
  if (!checks.configuration?.ok) return null;
  if (!checks.postgresql?.ok || !checks.services?.postgresRunning) return 'postgres';
  if (!checks.backend?.ok || !checks.services?.appRunning) return 'app';
  if (!checks.onionService?.ok || !checks.services?.torRunning || !checks.torConfig?.ok) return 'tor';
  return null;
}

function dependencyFailureForTarget(health, target) {
  const checks = Object.fromEntries(health.checks.map((check) => [check.name, check]));
  if (target === 'app' && (!checks.postgresql?.ok || !checks.services?.postgresRunning)) {
    return {
      ok: false,
      dependency: 'postgres',
      reason: 'backend recovery blocked because PostgreSQL is not healthy',
      postgresql: checks.postgresql ?? null,
      services: checks.services ?? null
    };
  }
  return null;
}

function targetHealthyFromChecks(health, target) {
  const checks = Object.fromEntries(health.checks.map((check) => [check.name, check]));
  if (target === 'postgres') return Boolean(checks.services?.postgresRunning && checks.postgresql?.ok);
  if (target === 'tor') return Boolean(checks.services?.torRunning && checks.torConfig?.ok && checks.onionService?.ok);
  return Boolean(checks.services?.appRunning && checks.backend?.ok);
}

function parsePublishedBackendUrl(stdout = '') {
  const line = String(stdout).trim().split(/\r?\n/).find(Boolean);
  if (!line) return null;
  const match = line.match(/^(?:https?:\/\/)?(?:\[([^\]]+)\]|([^:]+)):(\d+)$/);
  if (!match) return null;
  const host = match[1] ?? match[2];
  const port = match[3];
  const localHosts = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '::', '::1']);
  if (!localHosts.has(host)) return null;
  return `http://127.0.0.1:${port}${BACKEND_HEALTH_PATH}`;
}

async function probeBackendUrl(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return {
      ok: response.ok,
      code: response.status,
      stdout: JSON.stringify({ status: response.status, statusText: response.statusText, ok: response.ok, url }),
      stderr: ''
    };
  } catch (error) {
    const cause = error?.cause?.code ? ` (${error.cause.code})` : '';
    return { ok: false, code: null, stdout: '', stderr: `${error?.name ?? 'Error'}: ${error?.message ?? 'backend unavailable'}${cause}` };
  }
}

async function backendProbe(runner, cwd) {
  const publishedPort = await runner('docker', [...COMPOSE_BASE, '-f', ONION_COMPOSE, 'port', 'app', BACKEND_CONTAINER_PORT], { cwd });
  const publishedUrl = publishedPort.ok ? parsePublishedBackendUrl(publishedPort.stdout) : null;
  if (publishedUrl) {
    const publishedResult = await probeBackendUrl(publishedUrl);
    if (publishedResult.ok) return publishedResult;
  }

  return runner('docker', [...COMPOSE_BASE, '-f', ONION_COMPOSE, 'exec', '-T', 'app', ...BACKEND_HEALTH_COMMAND], { cwd });
}

async function defaultRunner(file, args, options) {
  try {
    const result = await execFileAsync(file, args, { ...options, shell: false, windowsHide: true, env: process.env, timeout: 30_000, maxBuffer: 512 * 1024 });
    return { ok: true, code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { ok: false, code: Number.isInteger(error.code) ? error.code : null, stdout: error.stdout, stderr: error.stderr || error.message };
  }
}

async function defaultProbe(file, args, options) { return defaultRunner(file, args, options); }
