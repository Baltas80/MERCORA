import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdminSystem, validateBackupId } from '../server/admin-system.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const HOURS = 60 * 60 * 1000;
export const DEFAULT_INTERVAL_MS = 6 * HOURS;
export const DEFAULT_RETENTION_DAYS = 7;
export const DEFAULT_RETENTION_COUNT = 28;

export function parseBackupConfig(env = process.env) {
  const intervalMs = Number(env.MERCORA_BACKUP_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS));
  const retentionDays = Number(env.MERCORA_BACKUP_RETENTION_DAYS ?? String(DEFAULT_RETENTION_DAYS));
  const retentionCount = Number(env.MERCORA_BACKUP_RETENTION_COUNT ?? String(DEFAULT_RETENTION_COUNT));
  if (!Number.isFinite(intervalMs) || intervalMs < 15 * 60 * 1000) throw new Error('MERCORA_BACKUP_INTERVAL_MS must be at least 15 minutes.');
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) throw new Error('MERCORA_BACKUP_RETENTION_DAYS must be between 1 and 365.');
  if (!Number.isInteger(retentionCount) || retentionCount < 2 || retentionCount > 1000) throw new Error('MERCORA_BACKUP_RETENTION_COUNT must be between 2 and 1000.');
  return { intervalMs, retentionDays, retentionCount };
}

export async function pruneBackups({ system, backupDir, retentionDays, retentionCount, now = Date.now() }) {
  const entries = await system.listBackups();
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  const root = await fs.realpath(backupDir);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (index < retentionCount && Date.parse(entry.modified_at) >= cutoff) continue;
    const id = validateBackupId(entry.id);
    const full = await fs.realpath(path.join(root, id));
    const relative = path.relative(root, full);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    const stat = await fs.stat(full);
    if (!stat.isFile()) continue;
    await fs.unlink(full);
    removed += 1;
  }
  return removed;
}

export async function runScheduler({ system, backupDir, intervalMs, retentionDays, retentionCount, logger = console }) {
  let running = false;
  async function cycle(reason) {
    if (running) return;
    running = true;
    try {
      logger.log(`[backup] starting database backup (${reason})`);
      const backup = await system.backupDb();
      logger.log(`[backup] completed ${backup.id} (${backup.size_bytes} bytes)`);
      const removed = await pruneBackups({ system, backupDir, retentionDays, retentionCount });
      logger.log(`[backup] retention removed ${removed} backup(s)`);
    } catch (error) {
      logger.error(`[backup] failed: ${String(error?.message || error)}`);
    } finally {
      running = false;
    }
  }
  await cycle('startup');
  const timer = setInterval(() => void cycle('scheduled'), intervalMs);
  return () => clearInterval(timer);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = parseBackupConfig();
  const backupDir = path.resolve(process.env.MERCORA_BACKUP_DIR ?? path.join(REPO_ROOT, 'backups'));
  const system = createAdminSystem({ backupDir });
  const stop = await runScheduler({ system, backupDir, ...config });
  const shutdown = signal => { stop(); console.log(`[backup] received ${signal}; shutting down`); process.exit(0); };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
