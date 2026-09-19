from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path

import psycopg

DATABASE_URL = os.environ.get("DATABASE_URL")


def _connection_args() -> dict[str, str]:
    if DATABASE_URL:
        return {"conninfo": DATABASE_URL}

    required = {
        "host": os.environ.get("MERCORA_DB_HOST", ""),
        "dbname": os.environ.get("MERCORA_DB_NAME", ""),
        "user": os.environ.get("MERCORA_DB_USER", ""),
        "password": os.environ.get("MERCORA_DB_PASSWORD", ""),
    }
    missing = [key for key, value in required.items() if not value]
    if missing:
        raise RuntimeError("database_configuration_incomplete")
    return required


@contextmanager
def connection():
    with psycopg.connect(**_connection_args()) as conn:
        yield conn


def migration_files() -> list[Path]:
    root = Path(__file__).resolve().parent.parent / "db" / "migrations"
    return sorted(root.glob("[0-9][0-9][0-9]_*.sql"))
