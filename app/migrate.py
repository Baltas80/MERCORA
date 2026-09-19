from __future__ import annotations
import sys
from pathlib import Path
from db import connection, migration_files

def migrate() -> None:
    files = migration_files()
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""CREATE TABLE IF NOT EXISTS schema_migrations(
                version TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )""")
            for path in files:
                version = path.name
                cur.execute("SELECT 1 FROM schema_migrations WHERE version=%s", (version,))
                if cur.fetchone():
                    continue
                cur.execute(path.read_text(encoding="utf-8"))
                cur.execute("INSERT INTO schema_migrations(version) VALUES(%s)", (version,))
        conn.commit()

if __name__ == "__main__":
    try:
        migrate()
    except Exception as exc:
        print(f"migration_failed: {type(exc).__name__}", file=sys.stderr)
        raise
