from __future__ import annotations

import os
import secrets
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from auth import (
    AuthenticatedAccount,
    authenticate_account,
    create_session,
    new_session_token,
    register_account,
    resolve_session,
    revoke_session,
    validate_pseudonym,
)
from db import connection
from rate_limit import FixedWindowRateLimiter

app = FastAPI(
    title="MERCORA API",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

APP_ENV = os.environ.get("MERCORA_ENV", "development")
COOKIE_SECURE = APP_ENV != "development"
SESSION_COOKIE = "mercora_session"
CSRF_COOKIE = "mercora_csrf"
MAX_REQUEST_BODY_BYTES = 1024 * 1024

login_limiter = FixedWindowRateLimiter(limit=8, window_seconds=60.0)
register_limiter = FixedWindowRateLimiter(limit=5, window_seconds=60.0)


class Credentials(BaseModel):
    pseudonym: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=1, max_length=1024)


def security_headers(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), geolocation=(), microphone=(), payment=()"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"


def set_auth_cookies(response: Response, session_token: str, csrf_token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        session_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="strict",
        path="/",
        max_age=8 * 60 * 60,
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf_token,
        httponly=False,
        secure=COOKIE_SECURE,
        samesite="strict",
        path="/",
        max_age=8 * 60 * 60,
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


def request_size_guard(request: Request) -> None:
    raw_length = request.headers.get("content-length")
    if raw_length is None:
        return
    try:
        length = int(raw_length)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid_content_length") from exc
    if length < 0 or length > MAX_REQUEST_BODY_BYTES:
        raise HTTPException(status_code=413, detail="request_too_large")


async def current_account(request: Request) -> AuthenticatedAccount:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    with connection() as conn:
        account = resolve_session(conn, token)
    if account is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    return account


async def require_csrf(
    request: Request,
    account: Annotated[AuthenticatedAccount, Depends(current_account)],
    x_csrf_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> AuthenticatedAccount:
    cookie_token = request.cookies.get(CSRF_COOKIE)
    if not cookie_token or not x_csrf_token or not secrets.compare_digest(cookie_token, x_csrf_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="csrf_failed")
    return account


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    try:
        request_size_guard(request)
        response = await call_next(request)
    except HTTPException as exc:
        response = Response(
            content='{"error":"request_rejected"}',
            status_code=exc.status_code,
            media_type="application/json",
        )
    security_headers(response)
    return response


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz")
def readyz() -> dict[str, str]:
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
    return {"status": "ready"}


@app.post("/auth/register", status_code=201)
def register(credentials: Credentials) -> dict[str, str]:
    pseudonym = credentials.pseudonym
    if not register_limiter.allow(pseudonym.lower()):
        raise HTTPException(status_code=429, detail="rate_limited")
    validate_pseudonym(pseudonym)
    with connection() as conn:
        account = register_account(conn, pseudonym, credentials.password)
    return {"pseudonym": account.pseudonym, "role": account.role}


@app.post("/auth/login")
def login(credentials: Credentials, response: Response) -> dict[str, str]:
    key = credentials.pseudonym.lower()
    if not login_limiter.allow(key):
        raise HTTPException(status_code=429, detail="rate_limited")

    with connection() as conn:
        account = authenticate_account(conn, credentials.pseudonym, credentials.password)
        if account is None:
            raise HTTPException(status_code=401, detail="invalid_credentials")
        session_token = create_session(conn, account.id)

    csrf_token = new_session_token()
    set_auth_cookies(response, session_token, csrf_token)
    return {"pseudonym": account.pseudonym, "role": account.role}


@app.get("/auth/me")
def me(
    account: Annotated[AuthenticatedAccount, Depends(current_account)],
) -> dict[str, str]:
    return {"pseudonym": account.pseudonym, "role": account.role}


@app.post("/auth/logout")
def logout(
    response: Response,
    request: Request,
    account: Annotated[AuthenticatedAccount, Depends(require_csrf)],
) -> dict[str, str]:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        with connection() as conn:
            revoke_session(conn, token)
    clear_auth_cookies(response)
    return {"status": "logged_out"}
