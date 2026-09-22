import { createAdminSystem } from '../server/admin-system.js';

const HOURS = 60 * 60 * 1000;
const intervalMs = Number(process.env.MERCORA_BACKUP_INTERVAL_MS ?? String(6 * HOURS));
const retentionDays = Number(process.env.MERCORA_BACKUP_RETENTION_DAYS ?? '7');
const retentionCount = Number(process.env.MERCORA_BACKUP_RETENTION_COUNT ?? '28');

if (!Number.isFinite(intervalMs) || intervalMs < 15 * 60 * 1000) {
  console.error('MERCORA_BACKUP_INTERVAL_MS must be at least 15 minutes.');
  process.exit(2);
}
if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
  console.error('MERCORA_BACKUP_RETENTION_DAYS must be between 1 and 365.');
  process.exit(2);
}
if (!Number.isInteger(retentionCount) || retentionCount < 2 || retentionCount > 1000) {
  console.error('MERCORA_BACKUP_RETENTION_COUNT must be between 2 and 1000.');
  process.exit(2);
}

const system = createAdminSystem();
let running = false;

async function cycle(reason) {
  if (running) return;
  running = true;
  try {
    console.log(`[backup] starting database backup (${reason})`);
    const backup = await system.backupDb();
    console.log(`[backup] completed ${backup.id} (${backup.size_bytes} bytes)`);
    const pruned = await system.pruneBackups({ maxAgeDays: retentionDays, maxCount: retentionCount });
    console.log(`[backup] retention removed ${pruned.removed} backup(s)`);
  } catch (error) {
    console.error(`[backup] failed: ${String(error?.message || error)}`);
  } finally {
    running = false;
  }
}

await cycle('startup');
const timer = setInterval(() => void cycle('scheduled'), intervalMs);

function shutdown(signal) {
  clearInterval(timer);
  console.log(`[backup] received ${signal}; shutting down`);
  process.exit(0);
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
