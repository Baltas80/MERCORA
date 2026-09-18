import os
from contextlib import contextmanager

import psycopg


DATABASE_URL = os.environ.get("DATABASE_URL")


@contextmanager
def connection():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required")
    with psycopg.connect(DATABASE_URL) as conn:
        yield conn
