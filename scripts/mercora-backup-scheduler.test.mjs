import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_INTERVAL_MS, parseBackupConfig, pruneBackups } from './mercora-backup-scheduler.mjs';

const ID_A = 'mercora-20260920T010000Z-aaaaaaaaaaaa.dump';
const ID_B = 'mercora-20260921T010000Z-bbbbbbbbbbbb.dump';
const ID_C = 'mercora-20260922T010000Z-cccccccccccc.dump';

test('backup scheduler defaults to a six-hour interval and bounded retention', () => {
  const config = parseBackupConfig({});
  assert.equal(config.intervalMs, DEFAULT_INTERVAL_MS);
  assert.equal(config.retentionDays, 7);
  assert.equal(config.retentionCount, 28);
});

test('backup scheduler rejects unsafe frequency and retention settings', () => {
  assert.throws(() => parseBackupConfig({ MERCORA_BACKUP_INTERVAL_MS: '60000' }), /15 minutes/);
  assert.throws(() => parseBackupConfig({ MERCORA_BACKUP_RETENTION_DAYS: '0' }), /retention days/);
  assert.throws(() => parseBackupConfig({ MERCORA_BACKUP_RETENTION_COUNT: '1' }), /retention count/);
});

test('retention deletes only managed files outside the age/count policy', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mercora-backups-'));
  await Promise.all([ID_A, ID_B, ID_C].map(id => fs.writeFile(path.join(dir, id), 'backup')));
  const system = {
    listBackups: async () => [
      { id: ID_C, modified_at: '2026-09-22T01:00:00.000Z' },
      { id: ID_B, modified_at: '2026-09-21T01:00:00.000Z' },
      { id: ID_A, modified_at: '2026-09-20T01:00:00.000Z' }
    ]
  };
  const removed = await pruneBackups({
    system,
    backupDir: dir,
    retentionDays: 2,
    retentionCount: 2,
    now: Date.parse('2026-09-22T12:00:00.000Z')
  });
  assert.equal(removed, 1);
  await assert.rejects(() => fs.access(path.join(dir, ID_A)));
  await fs.access(path.join(dir, ID_B));
  await fs.access(path.join(dir, ID_C));
  await fs.rm(dir, { recursive: true, force: true });
});
