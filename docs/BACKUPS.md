# MERCORA backups

The repository now includes a local PostgreSQL backup scheduler. It is intentionally separate from the privileged Admin Control API: the scheduler uses fixed Docker Compose arguments and never accepts a command, service name, database name, output path, or credential from the administrator UI.

## Defaults

- Interval: 6 hours.
- Minimum supported interval: 15 minutes.
- Retention: 7 days and 28 recent backups, whichever is more restrictive for pruning.
- Maximum dump size: 8 GiB.
- Maximum backup operation time: 15 minutes.
- Backup directory: `./backups` unless `MERCORA_BACKUP_DIR` is set.
- Backup files use a fixed filename pattern and are created with restrictive permissions where supported.

## Commands

Run the scheduler from the repository root:

```text
npm run backup
```

Run policy and retention tests:

```text
npm run backup:test
```

Configuration is supplied through environment variables:

- `MERCORA_BACKUP_INTERVAL_MS`
- `MERCORA_BACKUP_RETENTION_DAYS`
- `MERCORA_BACKUP_RETENTION_COUNT`
- `MERCORA_BACKUP_DIR`

No backup credentials are stored by the scheduler. PostgreSQL authentication remains inside the existing Compose/runtime boundary.

## Recovery boundary

This scheduler provides backup creation and retention. It does not silently restore data or overwrite a running database. Restore remains a separately authorized operational action and must be validated against the real MERCORA runtime before production use.

A backup is not considered a verified disaster-recovery mechanism until a real PostgreSQL restore has been performed in an isolated environment and the resulting application health, schema, and integrity checks have passed.
