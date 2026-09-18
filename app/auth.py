from __future__ import annotations

import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from passwords import hash_password, verify_password

PSEUDONYM_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9_-]{2,31})$")
MAX_PASSWORD_LENGTH = 1024
DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60


@dataclass(frozen=True)
class AuthenticatedAccount:
    id: UUID
    pseudonym: str
    role: str


def validate_pseudonym(pseudonym: str) -> str:
    if not isinstance(pseudonym, str):
        raise ValueError("invalid_pseudonym")
    if not PSEUDONYM_RE.fullmatch(pseudonym):
        raise ValueError("invalid_pseudonym")
    return pseudonym


def validate_password(password: str) -> str:
    if not isinstance(password, str) or not password:
        raise ValueError("password_required")
    if len(password) > MAX_PASSWORD_LENGTH:
        raise ValueError("password_too_long")
    return password


def _token_hash(raw_token: str) -> bytes:
    return hashlib.sha256(raw_token.encode("ascii")).digest()


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def register_account(conn, pseudonym: str, password: str) -> AuthenticatedAccount:
    pseudonym = validate_pseudonym(pseudonym)
    password = validate_password(password)
    account_id = uuid4()
    password_hash = hash_password(password)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO accounts (id, pseudonym, password_hash, role)
            VALUES (%s, %s, %s, 'buyer')
            RETURNING id, pseudonym, role
            """,
            (account_id, pseudonym, password_hash),
        )
        row = cur.fetchone()
    if row is None:
        raise RuntimeError("account_insert_failed")
    return AuthenticatedAccount(UUID(row[0]), row[1], row[2])


def authenticate_account(conn, pseudonym: str, password: str) -> AuthenticatedAccount | None:
    if not isinstance(pseudonym, str) or not isinstance(password, str):
        return None
    if not PSEUDONYM_RE.fullmatch(pseudonym) or not password or len(password) > MAX_PASSWORD_LENGTH:
        return None

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, pseudonym, password_hash, role, status
            FROM accounts
            WHERE lower(pseudonym) = lower(%s)
            LIMIT 1
            """,
            (pseudonym,),
        )
        row = cur.fetchone()

    if row is None:
        return None

    account_id, stored_pseudonym, stored_hash, role, status = row
    if not verify_password(password, stored_hash):
        return None
    if status != "active":
        return None
    normalized_id = account_id if isinstance(account_id, UUID) else UUID(account_id)
    return AuthenticatedAccount(normalized_id, stored_pseudonym, role)


def create_session(conn, account_id: UUID, ttl_seconds: int = DEFAULT_SESSION_TTL_SECONDS) -> str:
    if ttl_seconds <= 0:
        raise ValueError("invalid_session_ttl")
    raw_token = new_session_token()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=ttl_seconds)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sessions (id, account_id, token_hash, created_at, expires_at)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (uuid4(), account_id, _token_hash(raw_token), now, expires_at),
        )
    return raw_token


def resolve_session(conn, raw_token: str) -> AuthenticatedAccount | None:
    if not isinstance(raw_token, str) or len(raw_token) > 128:
        return None
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.id, a.pseudonym, a.role
            FROM sessions AS s
            JOIN accounts AS a ON a.id = s.account_id
            WHERE s.token_hash = %s
              AND s.revoked_at IS NULL
              AND s.expires_at > now()
              AND a.status = 'active'
            LIMIT 1
            """,
            (_token_hash(raw_token),),
        )
        row = cur.fetchone()
    if row is None:
        return None
    account_id = row[0] if isinstance(row[0], UUID) else UUID(row[0])
    return AuthenticatedAccount(account_id, row[1], row[2])


def revoke_session(conn, raw_token: str) -> None:
    if not isinstance(raw_token, str) or not raw_token:
        return
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sessions
            SET revoked_at = now()
            WHERE token_hash = %s
              AND revoked_at IS NULL
            """,
            (_token_hash(raw_token),),
        )
