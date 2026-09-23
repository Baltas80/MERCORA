import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_RETENTION_COUNT = 28;
const MAX_BACKUP_BYTES = 8 * 1024 * 1024 * 1024;
const BACKUP_TIMEOUT_MS = 15 * 60 * 1000;
const BACKUP_RE = /^mercora-(\d{8}T\d{6}Z)-[0-9a-f]{12}\.dump$/i;

export function parseBackupConfig(env = process.env) {
  const intervalMs = Number(env.MERCORA_BACKUP_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  const retentionDays = Number(env.MERCORA_BACKUP_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
  const retentionCount = Number(env.MERCORA_BACKUP_RETENTION_COUNT ?? DEFAULT_RETENTION_COUNT);
  if (!Number.isFinite(intervalMs) || intervalMs < 15 * 60 * 1000) throw new Error('backup interval must be at least 15 minutes');
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) throw new Error('backup retention days must be between 1 and 365');
  if (!Number.isInteger(retentionCount) || retentionCount < 2 || retentionCount > 1000) throw new Error('backup retention count must be between 2 and 1000');
  return { intervalMs, retentionDays, retentionCount };
}

function backupId(date = new Date()) {
  return `mercora-${date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${randomUUID().slice(0, 12)}.dump`;
}

function backupTimestamp(id) {
  const match = id.match(BACKUP_RE);
  if (!match) return NaN;
  const [, compact] = match;
  const [, date, time] = compact.match(/^(\d{8})T(\d{6})Z$/) ?? [];
  if (!date || !time) return NaN;
  return Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`);
}

function runPgDump({ output, cwd, timeoutMs = BACKUP_TIMEOUT_MS, runner = spawn }) {
  return new Promise((resolve, reject) => {
    const child = runner('docker', ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.onion.yml', 'exec', '-T', 'postgres', 'pg_dump', '-Fc', '-U', 'mercora', '-d', 'mercora'], {
      cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    const errors = [];
    let bytes = 0;
    let timedOut = false;
    let failed = null;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    const fail = error => { if (!failed) failed = error; child.kill('SIGTERM'); };
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BACKUP_BYTES) return fail(new Error('backup size limit exceeded'));
      output.write(chunk);
    });
    child.stderr.on('data', chunk => { if (errors.join('').length < 65536) errors.push(chunk.toString()); });
    child.on('error', fail);
    child.on('close', code => {
      clearTimeout(timer);
      output.end(() => resolve({ ok: !failed && !timedOut && code === 0, code, bytes, stderr: errors.join('').slice(0, 4000), error: failed?.message }));
    });
  });
}

export async function createBackup({ backupDir = path.join(ROOT, 'backups'), cwd = ROOT } = {}) {
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  const id = backupId();
  const destination = path.join(backupDir, id);
  const stream = (await import('node:fs')).createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  try {
    const result = await runPgDump({ output: stream, cwd });
    if (!result.ok) {
      await fs.rm(destination, { force: true });
      throw new Error(result.error || result.stderr || (result.code == null ? 'backup process failed' : `pg_dump exited with ${result.code}`));
    }
    return { id, size_bytes: result.bytes, path: destination };
  } catch (error) {
    stream.destroy();
    await fs.rm(destination, { force: true });
    throw error;
  }
}

export async function listBackups(backupDir) {
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  const entries = [];
  for (const name of await fs.readdir(backupDir)) {
    if (!BACKUP_RE.test(name)) continue;
    const stat = await fs.stat(path.join(backupDir, name));
    if (stat.isFile()) entries.push({ id: name, size_bytes: stat.size, modified_at: stat.mtime.toISOString() });
  }
  return entries.sort((a, b) => {
    const timestampDiff = backupTimestamp(b.id) - backupTimestamp(a.id);
    return Number.isNaN(timestampDiff) || timestampDiff === 0 ? b.modified_at.localeCompare(a.modified_at) : timestampDiff;
  });
}

export async function pruneBackups({ backupDir, retentionDays, retentionCount, now = Date.now() }) {
  const entries = await listBackups(backupDir);
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const backupTime = backupTimestamp(entries[index].id);
    const withinRetentionWindow = Number.isFinite(backupTime) ? backupTime >= cutoff : Date.parse(entries[index].modified_at) >= cutoff;
    if (index < retentionCount && withinRetentionWindow) continue;
    await fs.rm(path.join(backupDir, entries[index].id), { force: true });
    removed += 1;
  }
  return removed;
}

export async function runScheduler({ backupDir, cwd = ROOT, intervalMs, retentionDays, retentionCount, logger = console, create = createBackup } = {}) {
  let active = false;
  const cycle = async reason => {
    if (active) return;
    active = true;
    try {
      logger.log(`[backup] starting (${reason})`);
      const backup = await create({ backupDir, cwd });
      await pruneBackups({ backupDir, retentionDays, retentionCount });
      logger.log(`[backup] completed ${backup.id} (${backup.size_bytes} bytes)`);
    } catch (error) {
      logger.error(`[backup] failed: ${String(error?.message || error)}`);
    } finally {
      active = false;
    }
  };
  await cycle('startup');
  const timer = setInterval(() => void cycle('scheduled'), intervalMs);
  return () => clearInterval(timer);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = parseBackupConfig();
  const backupDir = path.resolve(process.env.MERCORA_BACKUP_DIR ?? path.join(ROOT, 'backups'));
  const stop = await runScheduler({ backupDir, ...config });
  const shutdown = signal => { stop(); console.log(`[backup] received ${signal}; shutting down`); process.exit(0); };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
