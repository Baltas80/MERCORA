from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
from uuid import UUID

from fastapi import HTTPException, Request, Response, status

from admin_policy import is_high_risk
from auth import AuthenticatedAccount, resolve_session
from db import connection

MAX_BODY = int(os.environ.get("MERCORA_MAX_BODY_BYTES", "1048576"))


def headers(response: Response) -> None:
    response.headers.update(
        {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Permissions-Policy": "camera=(),geolocation=(),microphone=(),payment=(),usb=()",
            "Content-Security-Policy": (
                "default-src 'self'; script-src 'self'; style-src 'self'; "
                "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
                "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
            ),
        }
    )


def guard_size(request: Request) -> None:
    raw = request.headers.get("content-length")
    if raw:
        try:
            n = int(raw)
        except ValueError as exc:
            raise HTTPException(400, "invalid_content_length") from exc
        if n < 0 or n > MAX_BODY:
            raise HTTPException(413, "request_too_large")


def request_id(request: Request) -> str:
    value = request.headers.get("X-Request-ID", "")
    return value if re.fullmatch(r"[A-Za-z0-9._-]{8,80}", value) else secrets.token_urlsafe(12)


def audit(
    cur,
    actor: UUID | None,
    action: str,
    resource_type: str,
    resource_id: UUID | None,
    decision: str,
    reason: str | None,
    req_id: str,
) -> None:
    cur.execute("SELECT pg_advisory_xact_lock(hashtextextended('mercora-admin-audit',0))")
    cur.execute("SELECT current_hash FROM admin_audit_events ORDER BY created_at DESC,id DESC LIMIT 1")
    prev = cur.fetchone()
    previous = prev[0] if prev else ""
    payload = json.dumps(
        {
            "actor": str(actor) if actor else None,
            "action": action,
            "resource_type": resource_type,
            "resource_id": str(resource_id) if resource_id else None,
            "decision": decision,
            "reason": reason,
            "request_id": req_id,
            "previous_hash": previous,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    current = hashlib.sha256(payload.encode()).hexdigest()
    cur.execute(
        """INSERT INTO admin_audit_events(
               actor_account_id,action_code,resource_type,resource_id,decision,
               reason,request_id,previous_hash,current_hash
           ) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (actor, action, resource_type, resource_id, decision, reason, req_id, previous, current),
    )


async def current_account(request: Request) -> AuthenticatedAccount:
    token = request.cookies.get("mercora_session")
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")
    with connection() as conn:
        account = resolve_session(conn, token)
    if account is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")
    return account


async def csrf_account(request: Request, account: AuthenticatedAccount) -> AuthenticatedAccount:
    token = request.cookies.get("mercora_csrf")
    header = request.headers.get("X-CSRF-Token")
    if not token or not header or not secrets.compare_digest(token, header):
        raise HTTPException(403, "csrf_failed")
    return account


def permission_set(cur, account_id: UUID) -> set[str]:
    cur.execute(
        """SELECT arp.permission_code
           FROM admin_role_bindings arb
           JOIN admin_role_permissions arp ON arp.role_id=arb.role_id
           WHERE arb.account_id=%s AND arb.revoked_at IS NULL""",
        (account_id,),
    )
    return {r[0] for r in cur.fetchall()}


def require_permission(
    cur,
    account: AuthenticatedAccount,
    permission: str,
    req_id: str,
    resource_type: str = "system",
    resource_id: UUID | None = None,
) -> set[str]:
    perms = permission_set(cur, account.id)
    if permission not in perms:
        audit(cur, account.id, permission, resource_type, resource_id, "denied", "permission_denied", req_id)
        raise HTTPException(403, "forbidden")
    return perms


def financial_open(cur) -> bool:
    cur.execute("SELECT value FROM system_state WHERE key='custody_mode'")
    custody = cur.fetchone()
    cur.execute("SELECT value FROM system_state WHERE key='marketplace_mode'")
    marketplace = cur.fetchone()
    # Fail closed: missing or unexpected state never enables financial operations.
    return (
        custody is not None
        and marketplace is not None
        and custody[0] == "normal"
        and marketplace[0] == "normal"
    )


async def read_limited_body(request: Request, limit: int) -> bytes:
    if limit <= 0:
        raise ValueError("invalid_body_limit")
    total = 0
    chunks: list[bytes] = []
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise HTTPException(413, "request_too_large")
        chunks.append(chunk)
    return b"".join(chunks)
