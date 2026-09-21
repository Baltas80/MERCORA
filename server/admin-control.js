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
const SENSITIVE = /(password|secret|token|seed|private.?key|mnemonic|authorization)/i;

function cleanDiagnostic(text = '') {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => !SENSITIVE.test(line))
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

function composeArgs(action, service) {
  if (!ACTIONS.includes(action)) throw new Error('Unsupported admin action');
  if (service !== undefined && !ALLOWED_SERVICES.has(service)) throw new Error('Unsupported service');

  const files = service === 'tor' || action === 'STATUS' || action === 'HEALTH_CHECK'
    ? [...COMPOSE_BASE, '-f', ONION_COMPOSE]
    : COMPOSE_BASE;

  switch (action) {
    case 'START': return [...files, 'up', '-d', ...(service ? [service] : [])];
    case 'STOP': return [...files, 'stop', ...(service ? [service] : [])];
    case 'RESTART': return [...files, 'restart', ...(service ? [service] : [])];
    case 'STATUS': return [...files, 'ps'];
    case 'HEALTH_CHECK': return [...files, 'ps'];
    default: return null;
  }
}

export function createAdminController({
  cwd = path.resolve(process.cwd()),
  runner = defaultRunner,
  probe = defaultProbe
} = {}) {
  async function run(action, service) {
    const args = composeArgs(action, service);
    if (args) return sanitizeResult(await runner('docker', args, { cwd }));
    if (action === 'RECOVER') return recover(service);
    throw new Error('Unsupported admin action');
  }

  async function recover(service) {
    if (service !== undefined && !ALLOWED_SERVICES.has(service)) throw new Error('Unsupported service');

    const target = service ?? 'app';
    const steps = [];
    steps.push({ step: `restart:${target}`, result: await run('RESTART', target) });
    if (!steps.at(-1).result.ok) {
      steps.push({ step: `start:${target}`, result: await run('START', target) });
    }
    steps.push({ step: 'health', result: await healthCheck() });
    return {
      ok: steps.every((entry) => entry.result.ok),
      target,
      steps
    };
  }

  async function healthCheck() {
    const checks = [];
    checks.push(await probe('node', ['--version'], { cwd }));
    checks.push(await runner('docker', [...COMPOSE_BASE, '-f', ONION_COMPOSE, 'ps'], { cwd }).then(sanitizeResult));
    checks.push(await probe('docker', ['version', '--format', '{{.Server.Version}}'], { cwd }));
    checks.push(await backendProbe());
    checks.push(await runner('docker', [...COMPOSE_BASE, '-f', ONION_COMPOSE, 'exec', '-T', 'tor', 'test', '-s', '/data/hostname'], { cwd }).then(sanitizeResult));
    checks.push(await probe('docker', ['volume', 'inspect', 'mercora_postgres_data'], { cwd }));
    return {
      ok: checks.every((item) => item.ok),
      checks: checks.map(sanitizeResult),
      platform: os.platform()
    };
  }

  return Object.freeze({ run, healthCheck });
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
    const result = await execFileAsync(file, args, {
      ...options,
      shell: false,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 512 * 1024
    });
    return { ok: true, code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { ok: false, code: Number.isInteger(error.code) ? error.code : null, stdout: error.stdout, stderr: error.stderr || error.message };
  }
}

async function defaultProbe(file, args, options) {
  return defaultRunner(file, args, options);
}
