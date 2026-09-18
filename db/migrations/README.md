# Database migrations

Migrations are append-only and numbered sequentially.

Rules:

- Never rewrite an applied migration.
- Every schema change gets a new migration.
- Destructive changes require an explicit rollback/restore plan.
- Production migrations must be reviewed before deployment.
- Credentials and connection strings never belong in migration files.

`001_initial.sql` establishes the initial marketplace persistence boundary. Application startup must not implicitly mutate production schema; a dedicated migration step will be introduced before production deployment.
