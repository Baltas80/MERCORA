import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseBackupConfig, listBackups, pruneBackups } from './mercora-backup-scheduler.mjs';

test('backup configuration enforces safe minimum interval and bounded retention', () => {
  assert.deepEqual(parseBackupConfig({
    MERCORA_BACKUP_INTERVAL_MS: String(15 * 60 * 1000),
    MERCORA_BACKUP_RETENTION_DAYS: '7',
    MERCORA_BACKUP_RETENTION_COUNT: '28'
  }), { intervalMs: 15 * 60 * 1000, retentionDays: 7, retentionCount: 28 });
  assert.throws(() => parseBackupConfig({ MERCORA_BACKUP_INTERVAL_MS: '1000' }), /at least 15 minutes/);
  assert.throws(() => parseBackupConfig({ MERCORA_BACKUP_RETENTION_DAYS: '0' }), /retention days/);
  assert.throws(() => parseBackupConfig({ MERCORA_BACKUP_RETENTION_COUNT: '1' }), /retention count/);
});

test('backup listing ignores unrelated files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mercora-backups-'));
  try {
    await fs.writeFile(path.join(dir, 'README.txt'), 'ignore');
    await fs.writeFile(path.join(dir, 'mercora-20260923T000000Z-0123456789ab.dump'), 'backup');
    const backups = await listBackups(dir);
    assert.equal(backups.length, 1);
    assert.equal(backups[0].id, 'mercora-20260923T000000Z-0123456789ab.dump');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('retention keeps the configured recent count and removes old managed dumps only', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mercora-backups-'));
  const now = Date.parse('2026-09-23T00:00:00Z');
  try {
    const names = [
      'mercora-20260923T000000Z-000000000001.dump',
      'mercora-20260922T000000Z-000000000002.dump',
      'mercora-20260901T000000Z-000000000003.dump',
      'other.dump'
    ];
    for (const name of names) await fs.writeFile(path.join(dir, name), name);
    const removed = await pruneBackups({ backupDir: dir, retentionDays: 7, retentionCount: 2, now });
    assert.equal(removed, 1);
    assert.equal((await fs.readdir(dir)).sort().join(','), names.filter(name => name !== names[2]).sort().join(','));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
