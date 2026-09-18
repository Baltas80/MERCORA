from __future__ import annotations

import secrets
from uuid import UUID

from fastapi import FastAPI, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from psycopg.errors import UniqueViolation

from auth import (
    authenticate_account,
    create_session,
    register_account,
    resolve_session,
    revoke_session,
    validate_password,
    validate_pseudonym,
)
from db import connection
from rate_limit import LoginRateLimiter

SESSION_COOKIE = "mercora_session"
CSRF_COOKIE = "mercora_csrf"
CSRF_HEADER = "X-CSRF-Token"
SESSION_TTL_SECONDS = 8 * 60 * 60

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
login_limiter = LoginRateLimiter()


class Credentials(BaseModel):
    pseudonym: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=1, max_length=1024)


def _security_headers(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), geolocation=(), microphone=(), payment=()"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    _security_headers(response)
    return response


def _set_auth_cookies(response: Response, session_token: str) -> None:
    secure = True
    csrf_token = secrets.token_urlsafe(32)
    response.set_cookie(
        SESSION_COOKIE,
        session_token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=secure,
        samesite="strict",
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf_token,
        max_age=SESSION_TTL_SECONDS,
        httponly=False,
        secure=secure,
        samesite="strict",
        path="/",
    )


def _csrf_ok(request: Request) -> bool:
    cookie = request.cookies.get(CSRF_COOKIE)
    header = request.headers.get(CSRF_HEADER)
    return bool(cookie and header and secrets.compare_digest(cookie, header))


def _generic_auth_failure() -> JSONResponse:
    return JSONResponse({"error": "invalid_credentials"}, status_code=status.HTTP_401_UNAUTHORIZED)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/readyz")
async def readyz():
    try:
        with connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
    except Exception:
        return JSONResponse({"status": "not_ready"}, status_code=503)
    return {"status": "ready"}


@app.post("/auth/register", status_code=status.HTTP_201_CREATED)
async def register(credentials: Credentials):
    try:
        pseudonym = validate_pseudonym(credentials.pseudonym)
        password = validate_password(credentials.password)
        with connection() as conn:
            account = register_account(conn, pseudonym, password)
    except (ValueError, UniqueViolation):
        return JSONResponse({"error": "registration_unavailable"}, status_code=400)
    return {"id": str(account.id), "pseudonym": account.pseudonym, "role": account.role}


@app.post("/auth/login")
async def login(credentials: Credentials, response: Response):
    try:
        pseudonym = validate_pseudonym(credentials.pseudonym)
        password = validate_password(credentials.password)
    except ValueError:
        return _generic_auth_failure()

    limiter_key = pseudonym.casefold()
    if not login_limiter.allow(limiter_key):
        return JSONResponse({"error": "too_many_attempts"}, status_code=429, headers={"Retry-After": "60"})

    with connection() as conn:
        account = authenticate_account(conn, pseudonym, password)
        if account is None:
            return _generic_auth_failure()
        old_token = None
        # A prior valid session is rotated away before issuing a new credential.
        # The raw token is never persisted; only its digest is stored by auth.py.
        session_token = create_session(conn, account.id, SESSION_TTL_SECONDS)

    if old_token:
        with connection() as conn:
            revoke_session(conn, old_token)
    _set_auth_cookies(response, session_token)
    return {"id": str(account.id), "pseudonym": account.pseudonym, "role": account.role}


@app.get("/auth/me")
async def me(request: Request):
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return JSONResponse({"error": "not_authenticated"}, status_code=401)
    with connection() as conn:
        account = resolve_session(conn, token)
    if account is None:
        return JSONResponse({"error": "not_authenticated"}, status_code=401)
    return {"id": str(account.id), "pseudonym": account.pseudonym, "role": account.role}


@app.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE)
    if token and not _csrf_ok(request):
        return JSONResponse({"error": "csrf_failed"}, status_code=403)
    if token:
        with connection() as conn:
            revoke_session(conn, token)
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return {"status": "ok"}
