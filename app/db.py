from __future__ import annotations
import os
from contextlib import contextmanager
from pathlib import Path
import psycopg

DATABASE_URL = os.environ.get("DATABASE_URL")

@contextmanager
def connection():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required")
    with psycopg.connect(DATABASE_URL) as conn:
        yield conn

def migration_files() -> list[Path]:
    root = Path(__file__).resolve().parent.parent / "db" / "migrations"
    return sorted(root.glob("[0-9][0-9][0-9]_*.sql"))
