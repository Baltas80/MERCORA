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

export function createAdminController({ cwd = path.resolve(process.cwd()), runner = defaultRunner, probe = defaultProbe, backendProbeFn = backendProbe, configurationProbe } = {}) {
  const configurationProbeFn = configurationProbe ?? (() => configurationCheck(cwd));

  async function run(action, service) {
    const args = composeArgs(action, service);
    if (action === 'STATUS') return status();
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
      tor: state(checks.services?.torRunning && checks.onionService?.ok),
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

    // With no explicit target, diagnose first and repair only the first affected
    // component in dependency order: PostgreSQL -> backend/app -> Tor.
    // This avoids restarting healthy services or the whole stack unnecessarily.
    if (target === undefined) {
      const diagnosis = await healthCheck();
      steps.push({ step: 'diagnosis', result: diagnosis });
      target = selectRecoveryTarget(diagnosis);
      if (target === null) {
        return { ok: diagnosis.ok, target: null, targetHealthy: diagnosis.ok, repaired: false, steps };
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
    const health = await healthCheck();
    steps.push({ step: 'health', result: health });
    const targetHealthy = targetHealthyFromChecks(health, target);
    return { ok: repaired && targetHealthy && health.ok, target, targetHealthy, repaired, steps };
  }

  async function healthCheck() {
    const checks = [];
    checks.push(sanitizeResult(configurationProbeFn()));
    checks[0].name = 'configuration';
    checks.push(named('node', await probe('node', ['--version'], { cwd })));
    checks.push(named('docker', await probe('docker', ['version', '--format', '{{.Server.Version}}'], { cwd })));
    checks.push(named('backend', await backendProbeFn()));
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
    checks.push(named('onionService', await runner('docker', [...COMPOSE_BASE, '-f', ONION_COMPOSE, 'exec', '-T', 'tor', 'test', '-s', '/data/hostname'], { cwd })));

    // Verify the Compose-defined persistent volume without assuming Docker's
    // project-name prefix (which varies with directory/COMPOSE_PROJECT_NAME).
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

function named(name, result) { return { name, ...sanitizeResult(result) }; }

function selectRecoveryTarget(health) {
  const checks = Object.fromEntries(health.checks.map((check) => [check.name, check]));
  if (!checks.configuration?.ok) return null;
  if (!checks.postgresql?.ok || !checks.services?.postgresRunning) return 'postgres';
  if (!checks.backend?.ok || !checks.services?.appRunning) return 'app';
  if (!checks.onionService?.ok || !checks.services?.torRunning) return 'tor';
  return null;
}

function targetHealthyFromChecks(health, target) {
  const checks = Object.fromEntries(health.checks.map((check) => [check.name, check]));
  if (target === 'postgres') return Boolean(checks.services?.postgresRunning && checks.postgresql?.ok);
  if (target === 'tor') return Boolean(checks.services?.torRunning && checks.onionService?.ok);
  return Boolean(checks.services?.appRunning && checks.backend?.ok);
}

async function backendProbe() {
  try {
    const response = await fetch('http://127.0.0.1:8080/api/healthz', { signal: AbortSignal.timeout(5_000) });
    return { ok: response.ok, code: response.status, stdout: `backend ${response.status}`, stderr: '' };
  } catch (error) {
    return { ok: false, code: null, stdout: '', stderr: error?.message ?? 'backend unavailable' };
  }
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
