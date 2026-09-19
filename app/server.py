from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, field_validator

from admin_actions import approve_request, create_request
from auth import AuthenticatedAccount, authenticate_account, create_session, new_session_token, register_account, resolve_session, revoke_all_sessions, revoke_session
from crypto_box import decrypt_text, encrypt_text
from db import connection
from dispute_policy import can_transition, valid_decision
from fees import calculate_percentage_fee
from inventory import commit_inventory_sale, reserve_inventory, release_inventory
from ledger import customer_liability, create_balanced_transaction, ensure_ledger_account, create_balanced_transaction, ensure_ledger_account
from payments import PaymentMethod, PaymentStatus, can_transition as payment_can_transition
from recovery import use_recovery_code
from security import audit, csrf_account, current_account, financial_open, guard_size, headers, permission_set, request_id, require_permission
from seller_store import normalize_name, normalize_slug, promo_hash
from settlement_service import confirm_payment_and_create_escrow
from storage import MAX_BYTES, store_upload
from rate_limit import FixedWindowRateLimiter
from mfa import generate_secret, provisioning_uri, verify_code, encrypt_secret, decrypt_secret
from reconciliation import record_asset_reconciliation, all_assets_reconciled
from risk import current_level

app = FastAPI(title="MERCORA API", docs_url=None, redoc_url=None, openapi_url=None)
COOKIE_SECURE = os.environ.get("MERCORA_ENV", "production") != "development"
SESSION_TTL = 8 * 60 * 60
STORAGE_ROOT = os.environ.get("MERCORA_STORAGE_ROOT", "/data")
PAYMENT_INGEST_SECRET = os.environ.get("MERCORA_PAYMENT_INGEST_SECRET", "")
CONFIRMATIONS = {"BTC": int(os.environ.get("MERCORA_CONFIRMATIONS_BTC", "3")), "LTC": int(os.environ.get("MERCORA_CONFIRMATIONS_LTC", "6")), "XMR": int(os.environ.get("MERCORA_CONFIRMATIONS_XMR", "10"))}
login_limiter = FixedWindowRateLimiter(8, 60)
register_limiter = FixedWindowRateLimiter(5, 60)

class Credentials(BaseModel):
    pseudonym: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=12, max_length=1024)

class RecoveryReset(BaseModel):
    pseudonym: str
    recovery_code: str
    new_password: str = Field(min_length=12, max_length=1024)

class ListingIn(BaseModel):
    category_id: UUID | None = None
    title: str = Field(min_length=3, max_length=160)
    description: str = Field(min_length=1, max_length=10000)
    price_minor: int = Field(ge=0)
    currency: str = Field(min_length=3, max_length=3)
    quantity: int = Field(ge=1, le=100000)
    @field_validator("currency")
    @classmethod
    def currency_upper(cls, value: str) -> str:
        return value.upper()

class CartItemIn(BaseModel):
    listing_id: UUID
    quantity: int = Field(ge=1, le=99)

class CheckoutIn(BaseModel):
    idempotency_key: str = Field(min_length=16, max_length=128)

class StoreIn(BaseModel):
    store_name: str = Field(min_length=2, max_length=80)
    store_slug: str = Field(min_length=3, max_length=80)
    asset_code: str = "BTC"
    promo_code: str | None = Field(default=None, max_length=128)

class QuoteIn(BaseModel):
    order_id: UUID
    asset_code: str = Field(min_length=3, max_length=3)

class PaymentIntentIn(BaseModel):
    quote_id: UUID
    idempotency_key: str = Field(min_length=16, max_length=128)

class DisputeIn(BaseModel):
    order_id: UUID
    seller_account_id: UUID
    reason_code: str
    description: str = Field(min_length=10, max_length=10000)

class DisputeMessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=10000)

class DecisionIn(BaseModel):
    outcome: str
    rationale: str = Field(min_length=10, max_length=10000)
    refund_atomic: int | None = Field(default=None, ge=0)
    seller_release_atomic: int | None = Field(default=None, ge=0)
    asset_code: str | None = None
    action_request_id: UUID

class AppealIn(BaseModel):
    reason: str = Field(min_length=10, max_length=5000)

class MessageIn(BaseModel):
    recipient_account_id: UUID
    body: str = Field(min_length=1, max_length=10000)

class OrderStatusIn(BaseModel):
    status: str

class AdminActionIn(BaseModel):
    permission_code: str
    reason: str = Field(min_length=10, max_length=2000)
    step_up_password: str = Field(min_length=12, max_length=1024)
    mfa_code: str | None = Field(default=None, min_length=6, max_length=6)
    resource_type: str | None = None
    resource_id: UUID | None = None

class ApprovalIn(BaseModel):
    mfa_code: str = Field(min_length=6, max_length=6)

class MFAEnrollIn(BaseModel):
    password: str = Field(min_length=12, max_length=1024)

class WithdrawalIn(BaseModel):
    asset_code: str = Field(min_length=3, max_length=3)
    amount_atomic: int = Field(gt=0)
    destination_ref: str = Field(min_length=8, max_length=512)
    idempotency_key: str = Field(min_length=16, max_length=128)

class PayoutIn(BaseModel):
    asset_code: str = Field(min_length=3, max_length=3)
    amount_atomic: int = Field(gt=0)
    mode: str
    idempotency_key: str = Field(min_length=16, max_length=128)

class ReconcileIn(BaseModel):
    asset_code: str = Field(min_length=3, max_length=3)
    network: str = Field(min_length=2, max_length=64)
    onchain_atomic: int = Field(ge=0)
    internal_liability_atomic: int = Field(ge=0)

class PromoIn(BaseModel):
    benefit_type: str
    benefit_asset_code: str | None = None
    benefit_atomic: int | None = Field(default=None, gt=0)
    benefit_percent: int | None = Field(default=None, ge=1, le=100)
    max_uses: int = Field(default=1, ge=1, le=100000)
    expires_at: datetime | None = None

class EmergencyIn(BaseModel):
    reason: str = Field(min_length=10, max_length=2000)
    action_request_id: UUID

class QuoteAdminIn(BaseModel):
    asset_code: str
    fiat_currency: str = "EUR"
    atomic_per_fiat_num: int = Field(gt=0)
    atomic_per_fiat_den: int = Field(gt=0)
    valid_until: str
    source: str = Field(min_length=2, max_length=120)

@app.middleware("http")
async def security_middleware(request: Request, call_next):
    try:
        guard_size(request)
        response = await call_next(request)
    except HTTPException as exc:
        response = Response('{"error":"request_rejected"}', status_code=exc.status_code, media_type="application/json")
    headers(response)
    response.headers["X-Request-ID"] = request_id(request)
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
def register(credentials: Credentials):
    key = credentials.pseudonym.lower()
    if not register_limiter.allow(key):
        raise HTTPException(429, "rate_limited")
    try:
        with connection() as conn:
            account, recovery_codes = register_account(conn, credentials.pseudonym, credentials.password)
            conn.commit()
        return {"pseudonym": account.pseudonym, "recovery_codes": recovery_codes}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        if "unique" in str(exc).lower():
            raise HTTPException(409, "pseudonym_unavailable") from exc
        raise

@app.post("/auth/login")
def login(credentials: Credentials, response: Response):
    if not login_limiter.allow(credentials.pseudonym.lower()):
        raise HTTPException(429, "rate_limited")
    with connection() as conn:
        account = authenticate_account(conn, credentials.pseudonym, credentials.password)
        if account is None:
            raise HTTPException(401, "invalid_credentials")
        revoke_all_sessions(conn, account.id)
        token = create_session(conn, account.id, SESSION_TTL)
        conn.commit()
    csrf = new_session_token()
    response.set_cookie("mercora_session", token, httponly=True, secure=COOKIE_SECURE, samesite="strict", path="/", max_age=SESSION_TTL)
    response.set_cookie("mercora_csrf", csrf, httponly=False, secure=COOKIE_SECURE, samesite="strict", path="/", max_age=SESSION_TTL)
    return {"pseudonym": account.pseudonym, "role": account.role}

@app.get("/auth/me")
async def me(account: Annotated[AuthenticatedAccount, Depends(current_account)]):
    return {"id": str(account.id), "pseudonym": account.pseudonym, "role": account.role}

@app.post("/auth/logout")
async def logout(request: Request, response: Response, account: Annotated[AuthenticatedAccount, Depends(current_account)]):
    await csrf_account(request, account)
    token = request.cookies.get("mercora_session")
    with connection() as conn:
        revoke_session(conn, token or "")
        conn.commit()
    response.delete_cookie("mercora_session", path="/")
    response.delete_cookie("mercora_csrf", path="/")
    return {"status": "logged_out"}

@app.post("/auth/recovery/reset")
def recovery_reset(body: RecoveryReset):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM accounts WHERE lower(pseudonym)=lower(%s) AND status<>'closed' LIMIT 1", (body.pseudonym,))
            row = cur.fetchone()
            if not row or not use_recovery_code(cur, UUID(str(row[0])), body.recovery_code):
                raise HTTPException(400, "invalid_recovery")
            from passwords import hash_password
            cur.execute("UPDATE accounts SET password_hash=%s,updated_at=now() WHERE id=%s", (hash_password(body.new_password), row[0]))
            revoke_all_sessions(conn, UUID(str(row[0])))
            conn.commit()
    return {"status": "password_reset"}

@app.get("/listings")
def listings(q: str | None = None, category_id: UUID | None = None, limit: int = 50, offset: int = 0):
    limit, offset = min(max(limit, 1), 100), max(offset, 0)
    clauses = ["l.status='active'", "i.available_quantity>0"]
    params: list[object] = []
    if q:
        clean = q[:120].strip()
        clauses.append("(l.title ILIKE %s OR l.description ILIKE %s)")
        params += [f"%{clean}%", f"%{clean}%"]
    if category_id:
        clauses.append("l.category_id=%s")
        params.append(category_id)
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(f"""SELECT l.id,l.seller_id,l.category_id,l.title,l.description,l.price_minor,l.currency,i.available_quantity
                           FROM listings l JOIN listing_inventory i ON i.listing_id=l.id
                           WHERE {' AND '.join(clauses)}
                           ORDER BY l.created_at DESC LIMIT %s OFFSET %s""", params + [limit, offset])
            return {"items": [{"id": str(r[0]), "seller_id": str(r[1]), "category_id": str(r[2]) if r[2] else None, "title": r[3], "description": r[4], "price_minor": r[5], "currency": r[6], "available_quantity": r[7]} for r in cur.fetchall()]}

@app.post("/listings", status_code=201)
async def create_listing(body: ListingIn, request: Request, account: Annotated[AuthenticatedAccount, Depends(current_account)]):
    await csrf_account(request, account)
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT status FROM sellers WHERE account_id=%s", (account.id,))
            seller = cur.fetchone()
            if not seller or seller[0] != "active":
                raise HTTPException(403, "seller_not_active")
            cur.execute("""INSERT INTO listings(seller_id,category_id,title,description,price_minor,currency,quantity,status)
                           VALUES(%s,%s,%s,%s,%s,%s,%s,'active') RETURNING id""",
                        (account.id, body.category_id, body.title.strip(), body.description.strip(), body.price_minor, body.currency, body.quantity))
            listing_id = cur.fetchone()[0]
            cur.execute("INSERT INTO listing_inventory(listing_id,available_quantity) VALUES(%s,%s)", (listing_id, body.quantity))
            conn.commit()
    return {"id": str(listing_id)}

@app.post("/listings/{listing_id}/report", status_code=201)
async def report_listing(listing_id: UUID, reason: str, request: Request, account: Annotated[AuthenticatedAccount, Depends(current_account)]):
    await csrf_account(request, account)
    if len(reason.strip()) < 3:
        raise HTTPException(400, "invalid_reason")
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM listings WHERE id=%s", (listing_id,))
            if not cur.fetchone():
                raise HTTPException(404, "not_found")
            cur.execute("INSERT INTO listing_reports(listing_id,reporter_account_id,reason_code,details) VALUES(%s,%s,'user_report',%s) RETURNING id", (listing_id, account.id, reason.strip()[:5000]))
            rid = cur.fetchone()[0]
            conn.commit()
    return {"id": str(rid), "status": "open"}

@app.post("/stores", status_code=202)
async def create_store(body: StoreIn, request: Request, account: Annotated[AuthenticatedAccount, Depends(current_account)]):
    await csrf_account(request, account)
    name, slug, asset = normalize_name(body.store_name), normalize_slug(body.store_slug), body.asset_code.upper()
    if asset not in {"BTC", "LTC", "XMR"}:
        raise HTTPException(400, "unsupported_asset")
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM seller_stores WHERE account_id=%s", (account.id,))
            if cur.fetchone():
                raise HTTPException(409, "seller_store_exists")
            if body.promo_code:
                cur.execute("""SELECT id,benefit_type,max_uses,used_count
                               FROM promo_codes
                               WHERE code_hash=%s AND status='active' AND valid_from<=now()
                                 AND (expires_at IS NULL OR expires_at>now())
                               FOR UPDATE""", (promo_hash(body.promo_code),))
                promo = cur.fetchone()
                if not promo or int(promo[3]) >= int(promo[2]):
                    raise HTTPException(400, "invalid_promo")
                if promo[1] != "free_store":
                    raise HTTPException(400, "promo_requires_server_fee_flow")
                cur.execute("""INSERT INTO seller_store_activations(account_id,requested_store_name,requested_store_slug,source,payment_status,promo_code_id,status)
                               VALUES(%s,%s,%s,'promo','not_required',%s,'pending') RETURNING id""", (account.id, name, slug, promo[0]))
                aid = cur.fetchone()[0]
                cur.execute("INSERT INTO promo_code_redemptions(promo_code_id,account_id,activation_id) VALUES(%s,%s,%s)", (promo[0], account.id, aid))
                cur.execute("UPDATE promo_codes SET used_count=used_count+1,status=CASE WHEN used_count+1>=max_uses THEN 'exhausted' ELSE status END WHERE id=%s", (promo[0],))
                cur.execute("INSERT INTO seller_stores(account_id,store_name,store_slug,status,activation_source,activation_code_id,activated_at) VALUES(%s,%s,%s,'active','promo',%s,now()) RETURNING id", (account.id, name, slug, promo[0]))
                store_id = cur.fetchone()[0]
                cur.execute("INSERT INTO sellers(account_id,display_name,status,activated_at) VALUES(%s,%s,'active',now()) ON CONFLICT(account_id) DO UPDATE SET display_name=EXCLUDED.display_name,status='active',activated_at=now()", (account.id, name))
                cur.execute("UPDATE accounts SET role='seller',updated_at=now() WHERE id=%s", (account.id,))
                cur.execute("UPDATE seller_store_activations SET status='activated',updated_at=now() WHERE id=%s", (aid,))
                conn.commit()
                return {"status": "activated", "store_id": str(store_id)}
            cur.execute("SELECT fee_atomic FROM seller_fee_rules WHERE asset_code=%s AND active=true", (asset,))
            fee = cur.fetchone()
            if not fee:
                raise HTTPException(503, "seller_fee_not_configured")
            aid = uuid4()
            cur.execute("""INSERT INTO seller_store_activations(id,account_id,requested_store_name,requested_store_slug,source,fee_asset_code,fee_snapshot_atomic,status)
                           VALUES(%s,%s,%s,%s,'paid',%s,%s,'pending')""", (aid, account.id, name, slug, asset, fee[0]))
            cur.execute("INSERT INTO sellers(account_id,display_name,status) VALUES(%s,%s,'pending') ON CONFLICT(account_id) DO NOTHING", (account.id, name))
            method = {"BTC": "bitcoin", "LTC": "litecoin", "XMR": "monero"}[asset]
            cur.execute("""INSERT INTO payment_intents(account_id,method,asset_code,network,amount_atomic,status,idempotency_key,external_reference,expires_at)
                           VALUES(%s,%s,%s,%s,%s,'awaiting_payment',%s,%s,now()+interval '30 minutes') RETURNING id""",
                        (account.id, method, asset, "mainnet", fee[0], f"seller-activation-{aid}", f"seller_activation:{aid}"))
            payment_id = cur.fetchone()[0]
            cur.execute("UPDATE seller_store_activations SET payment_intent_id=%s WHERE id=%s", (payment_id, aid))
            conn.commit()
    return {"status": "payment_required", "activation_id": str(aid), "payment_intent_id": str(payment_id), "fee_atomic": str(fee[0]), "asset_code": asset}

@app.get("/stores/me")
async def my_store(account: Annotated[AuthenticatedAccount, Depends(current_account)]):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id,store_name,store_slug,status,activation_source,activated_at FROM seller_stores WHERE account_id=%s", (account.id,))
            r = cur.fetchone()
            return {"store": None if not r else {"id": str(r[0]), "name": r[1], "slug": r[2], "status": r[3], "source": r[4], "activated_at": r[5]}}

@app.post("/cart")
async def add_cart(body: CartItemIn, request: Request, account: Annotated[AuthenticatedAccount, Depends(current_account)]):
    await csrf_account(request, account)
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO carts(account_id) VALUES(%s) ON CONFLICT(account_id) DO NOTHING", (account.id,))
            cur.execute("""SELECT status FROM listings WHERE id=%s""", (body.listing_id,))
            if not (cur.fetchone() or [None])[0] == "active":
                raise HTTPException(404, "listing_not_available")
            cur.execute("""INSERT INTO cart_items(cart_id,listing_id,quantity) VALUES(%s,%s,%s)
                           ON CONFLICT(cart_id,listing_id) DO UPDATE SET quantity=LEAST(99,cart_items.quantity+EXCLUDED.quantity)""",
                        (account.id, body.listing_id, body.quantity))
            cur.execute("UPDATE carts SET updated_at=now() WHERE account_id=%s", (account.id,))
            conn.commit()
    return {"status": "ok"}

@app.get("/cart")
async def get_cart(account: Annotated[AuthenticatedAccount, Depends(current_account)]):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT ci.listing_id,ci.quantity,l.title,l.price_minor,l.currency,l.seller_id
                           FROM cart_items ci JOIN listings l ON l.id=ci.listing_id WHERE ci.cart_id=%s ORDER BY ci.created_at""", (account.id,))
            return {"items": [{"listing_id": str(r[0]), "quantity": r[1], "title": r[2], "price_minor": r[3], "currency": r[4], "seller_id": str(r[5])} for r in cur.fetchall()]}

@app.post("/checkout")
async def checkout(body: CheckoutIn, request: Request, account: Annotated[AuthenticatedAccount, Depends(current_account)]):
    await csrf_account(request, account)
    with connection() as conn:
        with conn.cursor() as cur:
            if not financial_open(cur):
                raise HTTPException(503, "financial_operations_frozen")
            cur.execute("SELECT version,buyer_fee_bps,seller_fee_bps FROM fee_policies WHERE active=true")
            fp = cur.fetchone()
            if not fp:
                raise HTTPException(503, "fee_policy_not_configured")
            cur.execute("SELECT id,status,currency,subtotal_minor,buyer_fee_minor,total_minor FROM orders WHERE buyer_id=%s AND idempotency_key=%s", (account.id, body.idempotency_key))
            existing = cur.fetchone()
            if existing:
                return {"order_id": str(existing[0]), "status": existing[1], "currency": existing[2], "subtotal_minor": existing[3], "buyer_fee_minor": existing[4], "total_minor": existing[5], "idempotent": True}
            cur.execute("""SELECT ci.listing_id,ci.quantity,l.seller_id,l.title,l.price_minor,l.currency,i.available_quantity
                           FROM cart_items ci JOIN listings l ON l.id=ci.listing_id JOIN listing_inventory i ON i.listing_id=l.id
                           WHERE ci.cart_id=%s ORDER BY ci.listing_id FOR UPDATE OF l,i""", (account.id,))
            cart = cur.fetchall()
            if not cart:
                raise HTTPException(400, "empty_cart")
            currency = str(cart[0][5]); subtotal = 0; seller_fee = 0
            for r in cart:
                if r[5] != currency: raise HTTPException(400, "mixed_currency_order")
                if int(r[6]) < int(r[1]): raise HTTPException(409, "insufficient_stock")
                line = int(r[4]) * int(r[1]); subtotal += line; seller_fee += calculate_percentage_fee(line, int(fp[2]))
            buyer_fee = calculate_percentage_fee(subtotal, int(fp[1]))
            order_id = uuid4()
            cur.execute("""INSERT INTO orders(id,buyer_id,status,currency,subtotal_minor,buyer_fee_minor,seller_fee_minor,total_minor,fee_policy_version,idempotency_key)
                           VALUES(%s,%s,'pending_payment',%s,%s,%s,%s,%s,%s,%s)""",
                        (order_id, account.id, currency, subtotal, buyer_fee, seller_fee, subtotal + buyer_fee, fp[0], body.idempotency_key))
            for r in cart:
                qty, line = int(r[1]), int(r[4]) * int(r[1])
                cur.execute("UPDATE listing_inventory SET available_quantity=available_quantity-%s,reserved_quantity=reserved_quantity+%s,updated_at=now() WHERE listing_id=%s AND available_quantity>=%s",
                            (qty, qty, r[0], qty))
                if cur.rowcount != 1: raise HTTPException(409, "inventory_race")
                cur.execute("INSERT INTO order_items(order_id,listing_id,seller_id,title_snapshot,unit_price_minor,quantity,seller_fee_minor) VALUES(%s,%s,%s,%s,%s,%s,%s)",
                            (order_id, r[0], r[2], r[3], r[4], qty, calculate_percentage_fee(line, int(fp[2]))))
            cur.execute("INSERT INTO order_fee_entries(order_id,side,amount_minor,policy_version) VALUES(%s,'buyer',%s,%s),(%s,'seller',%s,%s)",
                        (order_id, buyer_fee, fp[0], order_id, seller_fee, fp[0]))
            cur.execute("DELETE FROM cart_items WHERE cart_id=%s", (account.id,))
            conn.commit()
    return {"order_id": str(order_id), "status": "pending_payment", "currency": currency, "subtotal_minor": subtotal, "buyer_fee_minor": buyer_fee, "seller_fee_minor": seller_fee, "total_minor": subtotal + buyer_fee}

@app.get("/orders")
async def orders(account: Annotated[AuthenticatedAccount, Depends(current_account)]):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id,status,currency,subtotal_minor,buyer_fee_minor,seller_fee_minor,total_minor,created_at,updated_at FROM orders WHERE buyer_id=%s ORDER BY created_at DESC LIMIT 100", (account.id,))
            return {"items": [{"id": str(r[0]), "status": r[1], "currency": r[2], "subtotal_minor": r[3], "buyer_fee_minor": r[4], "seller_fee_minor": r[5], "total_minor": r[6], "created_at": r[7], "updated_at": r[8]} for r in cur.fetchall()]}

@app.post("/orders/{order_id}/status")
async def change_order_status(order_id: UUID, body: OrderStatusIn, request: Request, account: Annotated[AuthenticatedAccount, Depends(current_account)]):
    await csrf_account(request, account)
    allowed = {
        "pending_payment": {"cancelled"},
        "payment_confirmed": {"processing"},
        "processing": {"shipped"},
        "shipped": {"delivered"},
        "delivered": {"completed"},
    }
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT status,buyer_id FROM orders WHERE id=%s FOR UPDATE", (order_id,))
            row = cur.fetchone()
            if not row: raise HTTPException(404, "not_found")
            current = row[0]
            if body.status not in allowed.get(current, set()): raise HTTPException(409, "invalid_order_transition")
            cur.execute("SELECT 1 FROM order_items WHERE order_id=%s AND seller_id=%s LIMIT 1", (order_id, account.id))
            seller_participant = cur.fetchone() is not None
            if body.status == "completed" and account.id != row[1]: raise HTTPException(403, "buyer_required")
            if body.status in {"shipped","delivered"} and not seller_participant: raise HTTPException(403, "seller_required")
            if body.status == "processing" and not seller_participant: raise HTTPException(403, "seller_required")
            cur.execute("UPDATE orders SET status=%s,updated_at=now() WHERE id=%s", (body.status, order_id))
            if body.status == "delivered":
                cur.execute("""UPDATE seller_escrows se SET release_eligible_at=now()+make_interval(secs=>ep.hold_after_delivery_seconds),updated_at=now()
                               FROM escrow_policies ep WHERE ep.version=se.policy_version AND se.order_id=%s AND se.status='held'""", (order_id,))
            conn.commit()
    return {"status": body.status}

@app.post("/payments/quote", status_code=201)
async def create_quote(body: QuoteIn, request: Request, account: Annotated[AuthenticatedAccount, Depends(current_account)]):
    await csrf_account(request, account)
    asset = body.asset_code.upper()
    with connection() as conn:
        with conn.cursor() as cur:
            if not financial_open(cur):
                raise HTTPException(503, "financial_operations_frozen")
            cur.execute("SELECT total_minor,currency FROM orders WHERE id=%s AND buyer_id=%s", (body.order_id, account.id))
            order = cur.fetchone()
            if not order: raise HTTPException(404, "order_not_found")
            cur.execute("""SELECT id,atomic_per_fiat_num,atomic_per_fiat_den,valid_until FROM asset_quotes
                           WHERE asset_code=%s AND fiat_currency=%s AND valid_until>now()
                           ORDER BY valid_until DESC LIMIT 1""", (asset, order[1]))
            rate = cur.fetchone()
            if not rate: raise HTTPException(503, "asset_quote_unavailable")
            atomic = (int(order[0]) * int(rate[1]) + int(rate[2]) - 1) // int(rate[2])
            cur.execute("""INSERT INTO payment_quotes(order_id,account_id,fiat_currency,fiat_minor,asset_code,asset_atomic,rate_num,rate_den,valid_until)
                           VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                        (body.order_id, account.id, order[1], order[0], asset, atomic, rate[1], rate[2], rate[3]))
            qid = cur.fetchone()[0]
            conn.commit()
    return {"quote_id": str(qid), "asset_code": asset, "asset_atomic": str(atomic), "valid_until": rate[3]}

@app.post("/payments/intent", status_code=201)
async def create_payment_intent(body: PaymentIntentIn, request: Request, account: Annotated[AuthenticatedAccount, Depends(current_account)]):
    await csrf_account(request, account)
    with connection() as conn:
        with conn.cursor() as cur:
            if not financial_open(cur):
                raise HTTPException(503, "financial_operations_frozen")
            cur.execute("""SELECT id,order_id,account_id,asset_code,asset_atomic,valid_until FROM payment_quotes
                           WHERE id=%s AND account_id=%s""", (body.quote_id, account.id))
            q = cur.fetchone()
            if not q or q[5] <= datetime.now(timezone.utc):
                raise HTTPException(400, "quote_expired")
            cur.execute("SELECT id FROM payment_intents WHERE idempotency_key=%s", (body.idempotency_key,))
            existing = cur.fetchone()
            if existing: return {"payment_intent_id": str(existing[0]), "idempotent": True}
            method = {"BTC": "bitcoin", "LTC": "litecoin", "XMR": "monero"}[q[3]]
            cur.execute("""INSERT INTO payment_intents(order_id,account_id,quote_id,method,asset_code,network,amount_atomic,status,idempotency_key,expires_at)
                           VALUES(%s,%s,%s,%s,%s,'mainnet',%s,'awaiting_payment',%s,now()+interval '30 minutes') RETURNING id""",
                        (q[1], account.id, body.quote_id, method, q[3], q[4], body.idempotency_key))
            pid = cur.fetchone()[0]
            cur.execute("UPDATE orders SET status='pending_payment',updated_at=now() WHERE id=%s AND buyer_id=%s", (q[1], account.id))
            conn.commit()
    return {"payment_intent_id": str(pid), "asset_code": q[3], "amount_atomic": str(q[4]), "status": "awaiting_payment"}

@app.post("/internal/payments/events")
async def ingest_payment_event(request: Request):
    if not PAYMENT_INGEST_SECRET:
        raise HTTPException(503, "payment_ingest_not_configured")
    raw = await request.body()
    signature = request.headers.get("X-MERCORA-Signature", "")
    expected = hmac.new(PAYMENT_INGEST_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(401, "invalid_signature")
    try: data = json.loads(raw)
    except json.JSONDecodeError as exc: raise HTTPException(400, "invalid_json") from exc
    required = {"payment_intent_id","event_key","asset_code","confirmations","verified"}
    if not required <= data.keys(): raise HTTPException(400, "invalid_event")
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id,order_id,account_id,asset_code,amount_atomic,status,external_reference FROM payment_intents WHERE id=%s FOR UPDATE", (data["payment_intent_id"],))
            pi = cur.fetchone()
            if not pi: raise HTTPException(404, "payment_not_found")
            if str(pi[3]) != str(data["asset_code"]).upper(): raise HTTPException(400, "asset_mismatch")
            if data.get("amount_atomic") is not None and int(data["amount_atomic"]) != int(pi[4]): raise HTTPException(409, "amount_mismatch")
            cur.execute("""INSERT INTO payment_events(payment_intent_id,asset_code,network,txid,amount_atomic,confirmations,event_type,event_key,raw_ref)
                           VALUES(%s,%s,%s,%s,%s,%s,'observer',%s,%s) ON CONFLICT(event_key) DO NOTHING""",
                        (pi[0], pi[3], "mainnet", data.get("txid"), pi[4], int(data["confirmations"]), data["event_key"], data.get("raw_ref")))
            confirmations = int(data["confirmations"])
            target = PaymentStatus.DETECTED if confirmations == 0 else PaymentStatus.CONFIRMING
            if bool(data["verified"]) and confirmations >= CONFIRMATIONS[str(pi[3])]:
                target = PaymentStatus.CONFIRMED
            current = PaymentStatus(str(pi[5]))
            if current != target and payment_can_transition(current, target):
                cur.execute("UPDATE payment_intents SET status=%s,confirmations=%s,confirmed_at=CASE WHEN %s='confirmed' THEN now() ELSE confirmed_at END,updated_at=now() WHERE id=%s",
                            (target.value, confirmations, target.value, pi[0]))
            if target is PaymentStatus.CONFIRMED:
                if pi[1]:
                    result = confirm_payment_and_create_escrow(cur, payment_id=UUID(str(pi[0])), adapter_verified=bool(data["verified"]))
                    cur.execute("UPDATE payment_intents SET status='confirmed',updated_at=now() WHERE id=%s", (pi[0],))
                    return_value = {"status": "confirmed", "order_id": str(result.order_id), "escrows": result.escrow_count}
                elif str(pi[6] or "").startswith("seller_activation:"):
                    aid = UUID(str(pi[6]).split(":",1)[1])
                    cur.execute("SELECT account_id,requested_store_name,requested_store_slug,promo_code_id FROM seller_store_activations WHERE id=%s FOR UPDATE", (aid,))
                    activation = cur.fetchone()
                    if not activation: raise HTTPException(404, "activation_not_found")
                    if int(pi[4]) <= 0: raise HTTPException(400, "invalid_activation_amount")
                    cur.execute("UPDATE seller_store_activations SET payment_status='verified',status='approved',updated_at=now() WHERE id=%s", (aid,))
                    cur.execute("INSERT INTO seller_stores(account_id,store_name,store_slug,status,activation_source,activated_at) VALUES(%s,%s,%s,'active','paid',now()) RETURNING id",
                                (activation[0],activation[1],activation[2]))
                    store_id = cur.fetchone()[0]
                    cur.execute("INSERT INTO sellers(account_id,display_name,status,activated_at) VALUES(%s,%s,'active',now()) ON CONFLICT(account_id) DO UPDATE SET status='active',activated_at=now()", (activation[0],activation[1]))
                    cur.execute("UPDATE accounts SET role='seller',updated_at=now() WHERE id=%s", (activation[0],))
                    cur.execute("UPDATE seller_store_activations SET status='activated',updated_at=now() WHERE id=%s", (aid,))
                    return_value = {"status":"confirmed","store_id":str(store_id)}
                else:
                    return_value = {"status":"confirmed"}
            else:
                return_value = {"status": target.value}
            conn.commit()
    return return_value

@app.post("/disputes", status_code=201)
async def open_dispute(body: DisputeIn, request: Request, account: Annotated[AuthenticatedAccount, Depends(current_account)]):
    await csrf_account(request, account)
    if body.reason_code not in {"non_delivery","item_not_as_described","damaged_in_transit","suspected_counterfeit","other"}: raise HTTPException(400,"invalid_reason")
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT o.buyer_id,oi.seller_id,o.status FROM orders o JOIN order_items oi ON oi.order_id=o.id
                           WHERE o.id=%s AND oi.seller_id=%s LIMIT 1""",(body.order_id,body.seller_account_id))
            row=cur.fetchone()
            if not row or account.id not in {row[0],row[1]} or row[2] not in {"payment_confirmed","processing","shipped","delivered","completed","disputed"}: raise HTTPException(403,"dispute_not_eligible")
            cur.execute("""INSERT INTO disputes(order_id,opened_by,buyer_account_id,seller_account_id,reason_code,description,status,response_deadline,decision_deadline)
                           VALUES(%s,%s,%s,%s,%s,%s,'open',now()+interval '48 hours',now()+interval '120 hours') RETURNING id""",
                        (body.order_id,account.id,row[0],row[1],body.reason_code,body.description.strip()))
            did=cur.fetchone()[0]
            cur.execute("UPDATE orders SET status='disputed',updated_at=now() WHERE id=%s",(body.order_id,))
            cur.execute("INSERT INTO dispute_events(dispute_id,actor_account_id,event_type,from_status,to_status,reason_code,idempotency_key) VALUES(%s,%s,'opened',NULL,'open',%s,%s)",
                        (did,account.id,body.reason_code,str(uuid4())))
            conn.commit()
    return {"id":str(did),"status":"open"}

@app.post("/disputes/{dispute_id}/messages")
async def dispute_message(dispute_id:UUID, body:DisputeMessageIn, request:Request, account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    encrypted=encrypt_text(body.body)
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT buyer_account_id,seller_account_id,status FROM disputes WHERE id=%s FOR UPDATE",(dispute_id,))
            row=cur.fetchone()
            if not row or account.id not in {row[0],row[1]}: raise HTTPException(403,"forbidden")
            role="buyer" if account.id==row[0] else "seller"
            cur.execute("INSERT INTO dispute_messages(dispute_id,author_account_id,author_role,encrypted_body) VALUES(%s,%s,%s,%s)",(dispute_id,account.id,role,encrypted))
            if row[2] in {"open","awaiting_buyer","awaiting_seller"}:
                cur.execute("UPDATE disputes SET status='under_review',updated_at=now() WHERE id=%s",(dispute_id,))
            conn.commit()
    return {"status":"accepted"}

@app.get("/disputes/{dispute_id}")
async def get_dispute(dispute_id:UUID, account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id,order_id,buyer_account_id,seller_account_id,reason_code,description,status,priority,assigned_to,response_deadline,decision_deadline,created_at,resolved_at FROM disputes WHERE id=%s",(dispute_id,))
            r=cur.fetchone()
            if not r: raise HTTPException(404,"not_found")
            if account.id not in {r[2],r[3]}:
                require_permission(cur,account,"orders.read","dispute",dispute_id)
            cur.execute("SELECT event_type,from_status,to_status,reason_code,created_at FROM dispute_events WHERE dispute_id=%s ORDER BY created_at",(dispute_id,))
            events=cur.fetchall()
            cur.execute("SELECT author_account_id,author_role,encrypted_body,created_at FROM dispute_messages WHERE dispute_id=%s ORDER BY created_at",(dispute_id,))
            msgs=cur.fetchall()
            return {"id":str(r[0]),"order_id":str(r[1]),"reason_code":r[4],"description":r[5],"status":r[6],"priority":r[7],"assigned_to":str(r[8]) if r[8] else None,"response_deadline":r[9],"decision_deadline":r[10],"created_at":r[11],"resolved_at":r[12],
                    "events":[{"type":x[0],"from":x[1],"to":x[2],"reason":x[3],"created_at":x[4]} for x in events],
                    "messages":[{"author":str(x[0]),"role":x[1],"body":decrypt_text(bytes(x[2])),"created_at":x[3]} for x in msgs]}

@app.post("/disputes/{dispute_id}/decide")
async def decide_dispute(dispute_id:UUID, body:DecisionIn, request:Request, account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    if not valid_decision(body.outcome,body.rationale): raise HTTPException(400,"invalid_decision")
    rid=request_id(request)
    with connection() as conn:
        with conn.cursor() as cur:
            require_permission(cur,account,"escrow.manage",rid,"dispute",dispute_id)
            cur.execute("SELECT requested_by,status,permission_code,expires_at FROM admin_action_requests WHERE id=%s FOR UPDATE",(body.action_request_id,))
            ar=cur.fetchone()
            if not ar or ar[0]!=account.id or ar[1]!="approved" or ar[2]!="escrow.manage": raise HTTPException(403,"approved_action_required")
            cur.execute("SELECT status FROM disputes WHERE id=%s FOR UPDATE",(dispute_id,))
            state=cur.fetchone()
            if not state or state[0] not in {"under_review","mediation"}: raise HTTPException(409,"invalid_dispute_state")
            financial=body.outcome in {"buyer_refund","seller_release","partial_settlement"}
            cur.execute("""INSERT INTO dispute_decisions(dispute_id,decided_by,outcome,refund_atomic,seller_release_atomic,asset_code,rationale,financial_action_status)
                           VALUES(%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (dispute_id,account.id,body.outcome,body.refund_atomic,body.seller_release_atomic,body.asset_code,body.rationale,"pending" if financial else "not_required"))
            cur.execute("UPDATE disputes SET status='decided',updated_at=now() WHERE id=%s",(dispute_id,))
            cur.execute("UPDATE admin_action_requests SET status='executed',executed_at=now() WHERE id=%s",(body.action_request_id,))
            audit(cur,account.id,"dispute.decide","dispute",dispute_id,"allowed",body.outcome,rid)
            conn.commit()
    return {"status":"decided","financial_action":"pending" if financial else "not_required"}

@app.post("/disputes/{dispute_id}/appeal",status_code=201)
async def appeal_dispute(dispute_id:UUID,body:AppealIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT status,buyer_account_id,seller_account_id FROM disputes WHERE id=%s FOR UPDATE",(dispute_id,))
            r=cur.fetchone()
            if not r or r[0]!="decided" or account.id not in {r[1],r[2]}: raise HTTPException(403,"appeal_not_allowed")
            cur.execute("INSERT INTO dispute_appeals(dispute_id,opened_by,reason) VALUES(%s,%s,%s) RETURNING id",(dispute_id,account.id,body.reason))
            aid=cur.fetchone()[0]
            cur.execute("UPDATE disputes SET status='appealed',updated_at=now() WHERE id=%s",(dispute_id,))
            conn.commit()
    return {"appeal_id":str(aid),"status":"open"}

@app.post("/messages")
async def send_message(body:MessageIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    if body.recipient_account_id==account.id: raise HTTPException(400,"invalid_recipient")
    encrypted=encrypt_text(body.body)
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM account_blocks WHERE blocker_account_id=%s AND blocked_account_id=%s",(body.recipient_account_id,account.id))
            if cur.fetchone(): raise HTTPException(403,"blocked")
            thread=f"{min(str(account.id),str(body.recipient_account_id))}:{max(str(account.id),str(body.recipient_account_id))}"
            cur.execute("INSERT INTO messages(thread_key,sender_account_id,recipient_account_id,encrypted_body,encryption_version) VALUES(%s,%s,%s,%s,'v1') RETURNING id",(thread,account.id,body.recipient_account_id,encrypted))
            mid=cur.fetchone()[0]
            cur.execute("INSERT INTO notifications(account_id,type,payload) VALUES(%s,'message',jsonb_build_object('message_id',%s))",(body.recipient_account_id,mid))
            conn.commit()
    return {"id":str(mid)}

@app.get("/messages")
async def get_messages(account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id,sender_account_id,recipient_account_id,encrypted_body,created_at FROM messages WHERE sender_account_id=%s OR recipient_account_id=%s ORDER BY created_at DESC LIMIT 100",(account.id,account.id))
            return {"items":[{"id":str(r[0]),"sender_account_id":str(r[1]),"recipient_account_id":str(r[2]),"body":decrypt_text(bytes(r[3])),"created_at":r[4]} for r in cur.fetchall()]}

@app.post("/uploads/images",status_code=201)
async def upload_image(request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    media=request.headers.get("content-type","").split(";")[0].lower()
    data=await request.body()
    if len(data)>MAX_BYTES: raise HTTPException(413,"upload_too_large")
    try:key,size,digest,scan=store_upload(data,media,"listing_image",STORAGE_ROOT)
    except Exception as exc: raise HTTPException(400,"upload_rejected") from exc
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO uploads(owner_account_id,object_key,media_type,byte_size,sha256,purpose,scan_status) VALUES(%s,%s,%s,%s,%s,'listing_image',%s) RETURNING id",(account.id,key,media,size,digest,scan))
            uid=cur.fetchone()[0]; conn.commit()
    return {"id":str(uid),"object_key":key}

@app.post("/ratings",status_code=201)
async def rate_seller(order_id:UUID,seller_account_id:UUID,score:int,comment:str|None=None,request:Request=None,account:Annotated[AuthenticatedAccount,Depends(current_account)]=None):
    await csrf_account(request,account)
    if not 1<=score<=5: raise HTTPException(400,"invalid_score")
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT buyer_id,status FROM orders WHERE id=%s",(order_id,)); o=cur.fetchone()
            if not o or o[0]!=account.id or o[1]!="completed": raise HTTPException(403,"rating_not_allowed")
            cur.execute("SELECT 1 FROM order_items WHERE order_id=%s AND seller_id=%s",(order_id,seller_account_id))
            if not cur.fetchone(): raise HTTPException(403,"seller_not_in_order")
            cur.execute("INSERT INTO seller_ratings(order_id,seller_account_id,buyer_account_id,score,comment) VALUES(%s,%s,%s,%s,%s) RETURNING id",(order_id,seller_account_id,account.id,score,(comment or "")[:2000]))
            rid=cur.fetchone()[0]
            cur.execute("UPDATE sellers SET reputation_score=((reputation_score*10)+%s)/11,updated_at=now() WHERE account_id=%s",(score,seller_account_id))
            conn.commit()
    return {"id":str(rid)}

@app.post("/admin/actions",status_code=201)
async def create_admin_action(body:AdminActionIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    from passwords import verify_password
    if not verify_password(body.step_up_password, _admin_password_hash(account.id)):
        raise HTTPException(403,"step_up_failed")
    rid=request_id(request)
    with connection() as conn:
        with conn.cursor() as cur:
            require_permission(cur,account,body.permission_code,rid,body.resource_type or "system",body.resource_id)
            action_id=create_request(cur,account.id,body.permission_code,body.resource_type,body.resource_id,body.reason)
            audit(cur,account.id,"admin.action.request","system",action_id,"allowed",body.permission_code,rid)
            conn.commit()
    return {"action_request_id":str(action_id),"status":"requested"}

@app.post("/admin/actions/{action_id}/approve")
async def approve_admin_action(action_id:UUID,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    rid=request_id(request)
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT permission_code,requested_by,status FROM admin_action_requests WHERE id=%s FOR UPDATE",(action_id,))
            row=cur.fetchone()
            if not row or row[2]!="requested": raise HTTPException(404,"action_not_available")
            require_permission(cur,account,row[0],rid,"admin_action",action_id)
            if row[1]==account.id: raise HTTPException(403,"independent_approver_required")
            if not approve_request(cur,action_id,account.id): raise HTTPException(409,"approval_failed")
            audit(cur,account.id,"admin.action.approve","admin_action",action_id,"allowed","second_approver",rid)
            conn.commit()
    return {"status":"approved"}

@app.post("/admin/emergency")
async def execute_emergency(body:EmergencyIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    rid=request_id(request)
    with connection() as conn:
        with conn.cursor() as cur:
            require_permission(cur,account,"emergency.manage",rid,"system")
            cur.execute("SELECT requested_by,status,permission_code,expires_at FROM admin_action_requests WHERE id=%s FOR UPDATE",(body.action_request_id,))
            row=cur.fetchone()
            if not row or row[0]!=account.id or row[1]!="approved" or row[2]!="emergency.manage": raise HTTPException(403,"approved_action_required")
            cur.execute("UPDATE system_state SET value='emergency',updated_at=now() WHERE key IN('custody_mode','marketplace_mode')")
            cur.execute("INSERT INTO emergency_events(action,actor_account_id,reason,state_after,authorization_ref) VALUES('freeze',%s,%s,'emergency',%s)",(account.id,body.reason,str(body.action_request_id)))
            cur.execute("UPDATE admin_action_requests SET status='executed',executed_at=now() WHERE id=%s",(body.action_request_id,))
            audit(cur,account.id,"emergency.freeze","system",None,"allowed",body.reason,rid)
            conn.commit()
    return {"status":"emergency"}

@app.post("/admin/asset-quotes",status_code=201)
async def set_asset_quote(body:QuoteAdminIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account); rid=request_id(request)
    with connection() as conn:
        with conn.cursor() as cur:
            require_permission(cur,account,"settings.manage",rid,"asset_quote")
            cur.execute("""INSERT INTO asset_quotes(asset_code,fiat_currency,atomic_per_fiat_num,atomic_per_fiat_den,valid_until,source)
                           VALUES(%s,%s,%s,%s,%s,%s) RETURNING id""",
                        (body.asset_code.upper(),body.fiat_currency.upper(),body.atomic_per_fiat_num,body.atomic_per_fiat_den,body.valid_until,body.source))
            qid=cur.fetchone()[0]; conn.commit()
    return {"id":str(qid)}

@app.get("/admin/overview")
async def admin_overview(request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    rid=request_id(request)
    with connection() as conn:
        with conn.cursor() as cur:
            require_permission(cur,account,"users.read",rid)
            cur.execute("SELECT count(*) FROM accounts"); users=cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM sellers WHERE status='active'"); sellers=cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM orders"); orders_count=cur.fetchone()[0]
            cur.execute("SELECT value FROM system_state WHERE key='custody_mode'"); custody=cur.fetchone()
            cur.execute("SELECT count(*) FROM disputes WHERE status IN('open','under_review','mediation','appealed')"); disputes=cur.fetchone()[0]
            return {"users":users,"active_sellers":sellers,"orders":orders_count,"open_disputes":disputes,"custody_mode":custody[0] if custody else "unknown"}

@app.get("/notifications")
async def notifications(account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id,type,payload,read_at,created_at FROM notifications WHERE account_id=%s ORDER BY created_at DESC LIMIT 100",(account.id,))
            return {"items":[{"id":str(r[0]),"type":r[1],"payload":r[2],"read_at":r[3],"created_at":r[4]} for r in cur.fetchall()]}

@app.post("/auth/admin/mfa/enroll")
async def admin_mfa_enroll(body:MFAEnrollIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    from passwords import verify_password
    if not verify_password(body.password,_admin_password_hash(account.id)): raise HTTPException(403,"invalid_credentials")
    with connection() as conn:
        with conn.cursor() as cur:
            require_permission(cur,account,"settings.manage",request_id(request),"admin_mfa")
            cur.execute("SELECT 1 FROM admin_mfa_credentials WHERE account_id=%s",(account.id,))
            if cur.fetchone(): raise HTTPException(409,"mfa_already_enrolled")
            secret=generate_secret()
            cur.execute("INSERT INTO admin_mfa_credentials(account_id,encrypted_secret) VALUES(%s,%s)",(account.id,encrypt_secret(secret)))
            conn.commit()
    return {"secret":secret,"otpauth_uri":provisioning_uri(secret,account.pseudonym)}

@app.post("/wallet/withdrawals",status_code=201)
async def request_withdrawal(body:WithdrawalIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    asset=body.asset_code.upper()
    if asset not in {"BTC","LTC","XMR"}: raise HTTPException(400,"unsupported_asset")
    with connection() as conn:
        with conn.cursor() as cur:
            if not financial_open(cur): raise HTTPException(503,"financial_operations_frozen")
            cur.execute("SELECT id,state FROM withdrawal_requests WHERE idempotency_key=%s",(body.idempotency_key,))
            existing=cur.fetchone()
            if existing: return {"id":str(existing[0]),"state":existing[1],"idempotent":True}
            balance=customer_liability(cur,account.id,asset)
            if balance<body.amount_atomic: raise HTTPException(409,"insufficient_balance")
            customer=ensure_ledger_account(cur,code=f"customer:{account.id}",asset_code=asset,account_type="customer_liability",owner_account_id=account.id)
            hold=ensure_ledger_account(cur,code=f"withdrawal-hold:{account.id}",asset_code=asset,account_type="withdrawal_hold",owner_account_id=account.id)
            create_balanced_transaction(cur,asset_code=asset,transaction_type="withdrawal_reserve",reference_type="withdrawal",reference_id=None,idempotency_key=body.idempotency_key,lines=[(customer,"debit",body.amount_atomic),(hold,"credit",body.amount_atomic)])
            cur.execute("INSERT INTO withdrawal_requests(account_id,asset_code,amount_atomic,destination_ref,idempotency_key,state) VALUES(%s,%s,%s,%s,%s,'risk_review') RETURNING id",(account.id,asset,body.amount_atomic,body.destination_ref,body.idempotency_key))
            wid=cur.fetchone()[0]
            conn.commit()
    return {"id":str(wid),"state":"risk_review"}

@app.post("/payouts",status_code=201)
async def request_payout(body:PayoutIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    asset=body.asset_code.upper()
    if asset not in {"BTC","LTC","XMR"}: raise HTTPException(400,"unsupported_asset")
    with connection() as conn:
        with conn.cursor() as cur:
            if not financial_open(cur): raise HTTPException(503,"financial_operations_frozen")
            cur.execute("SELECT status FROM sellers WHERE account_id=%s",(account.id,))
            seller=cur.fetchone()
            if not seller or seller[0]!="active": raise HTTPException(403,"seller_not_active")
            level=current_level(cur,account.id)
            cur.execute("SELECT requires_level,active FROM seller_payout_policies WHERE mode=%s",(body.mode,))
            policy=cur.fetchone()
            if not policy or not policy[1] or level["level"]<int(policy[0]): raise HTTPException(403,"payout_mode_not_eligible")
            if body.mode=="advance_payout" and not level["advance_payout_allowed"]: raise HTTPException(403,"advance_payout_not_allowed")
            balance=customer_liability(cur,account.id,asset)
            if balance<body.amount_atomic: raise HTTPException(409,"insufficient_balance")
            cur.execute("INSERT INTO seller_payout_requests(seller_account_id,asset_code,amount_atomic,mode,idempotency_key,status) VALUES(%s,%s,%s,%s,%s,'risk_review') RETURNING id",(account.id,asset,body.amount_atomic,body.mode,body.idempotency_key))
            pid=cur.fetchone()[0]
            conn.commit()
    return {"id":str(pid),"status":"risk_review","level":level}

@app.post("/admin/promos",status_code=201)
async def create_promo(body:PromoIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    if body.benefit_type not in {"free_store","fee_discount_fixed","fee_discount_percent"}: raise HTTPException(400,"invalid_benefit")
    code=__import__("seller_store").generate_promo()
    asset=(body.benefit_asset_code or "").upper() or None
    if body.benefit_type=="free_store" and (asset or body.benefit_atomic or body.benefit_percent): raise HTTPException(400,"invalid_benefit")
    if body.benefit_type=="fee_discount_fixed" and (not asset or body.benefit_atomic is None or body.benefit_percent): raise HTTPException(400,"invalid_benefit")
    if body.benefit_type=="fee_discount_percent" and (asset or body.benefit_atomic or body.benefit_percent is None): raise HTTPException(400,"invalid_benefit")
    with connection() as conn:
        with conn.cursor() as cur:
            rid=request_id(request)
            require_permission(cur,account,"promos.manage",rid,"promo")
            cur.execute("INSERT INTO promo_codes(code_hash,benefit_type,benefit_asset_code,benefit_atomic,benefit_percent,max_uses,expires_at,created_by) VALUES(%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                        (promo_hash(code),body.benefit_type,asset,body.benefit_atomic,body.benefit_percent,body.max_uses,body.expires_at,account.id))
            pid=cur.fetchone()[0]; audit(cur,account.id,"promo.create","promo",pid,"allowed","plaintext_returned_once",rid); conn.commit()
    return {"id":str(pid),"code":code}

@app.post("/admin/reconciliation",status_code=201)
async def reconcile(body:ReconcileIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    rid=request_id(request)
    with connection() as conn:
        with conn.cursor() as cur:
            require_permission(cur,account,"settings.manage",rid,"reconciliation")
            run_id=record_asset_reconciliation(cur,body.asset_code,body.network,body.onchain_atomic,body.internal_liability_atomic)
            conn.commit()
    return {"run_id":str(run_id)}

@app.post("/admin/emergency/clear")
async def clear_emergency(request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    rid=request_id(request)
    with connection() as conn:
        with conn.cursor() as cur:
            require_permission(cur,account,"emergency.manage",rid,"system")
            if not all_assets_reconciled(cur): raise HTTPException(409,"reconciliation_required")
            cur.execute("UPDATE system_state SET value='normal',updated_at=now() WHERE key IN('custody_mode','marketplace_mode')")
            cur.execute("INSERT INTO emergency_events(action,actor_account_id,reason,state_before,state_after,authorization_ref) VALUES('clear',%s,'reconciliation_passed','emergency','normal',%s)",(account.id,rid))
            audit(cur,account.id,"emergency.clear","system",None,"allowed","reconciliation_passed",rid)
            conn.commit()
    return {"status":"normal"}

@app.get("/categories")
def get_categories():
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id,name,slug FROM categories WHERE active=true ORDER BY name")
            return {"items":[{"id":str(r[0]),"name":r[1],"slug":r[2]} for r in cur.fetchall()]}

@app.get("/seller/listings")
async def seller_listings(account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id,title,description,price_minor,currency,quantity,status,shipping_required,created_at,updated_at FROM listings WHERE seller_id=%s ORDER BY created_at DESC LIMIT 200",(account.id,))
            return {"items":[{"id":str(r[0]),"title":r[1],"description":r[2],"price_minor":r[3],"currency":r[4],"quantity":r[5],"status":r[6],"shipping_required":r[7],"created_at":r[8],"updated_at":r[9]} for r in cur.fetchall()]}

@app.get("/favorites")
async def favorites(account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT l.id,l.title,l.price_minor,l.currency FROM favorites f JOIN listings l ON l.id=f.listing_id WHERE f.account_id=%s ORDER BY f.created_at DESC LIMIT 200",(account.id,))
            return {"items":[{"id":str(r[0]),"title":r[1],"price_minor":r[2],"currency":r[3]} for r in cur.fetchall()]}

@app.post("/favorites/{listing_id}",status_code=201)
async def favorite(listing_id:UUID,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM listings WHERE id=%s AND status='active'",(listing_id,))
            if not cur.fetchone(): raise HTTPException(404,"not_found")
            cur.execute("INSERT INTO favorites(account_id,listing_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",(account.id,listing_id)); conn.commit()
    return {"status":"saved"}

@app.delete("/favorites/{listing_id}")
async def unfavorite(listing_id:UUID,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM favorites WHERE account_id=%s AND listing_id=%s",(account.id,listing_id)); conn.commit()
    return {"status":"removed"}

@app.post("/orders/{order_id}/shipping")
async def set_shipping(order_id:UUID,body:ShippingIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    if body.country.upper()!=body.country or len(body.country)!=2: raise HTTPException(400,"country_must_be_iso2_upper")
    encrypted=encrypt_text(json.dumps(body.model_dump(),sort_keys=True,separators=(",",":")))
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT buyer_id FROM orders WHERE id=%s FOR UPDATE",(order_id,)); row=cur.fetchone()
            if not row or row[0]!=account.id: raise HTTPException(403,"shipping_not_allowed")
            cur.execute("""INSERT INTO shipping_records(order_id,actor_account_id,purpose,encrypted_payload,encryption_version)
                           VALUES(%s,%s,'order_delivery',%s,'v1')
                           ON CONFLICT(order_id) DO UPDATE SET actor_account_id=EXCLUDED.actor_account_id,encrypted_payload=EXCLUDED.encrypted_payload,updated_at=now()""",(order_id,account.id,encrypted)); conn.commit()
    return {"status":"saved"}

@app.get("/orders/{order_id}/shipping")
async def get_shipping(order_id:UUID,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT o.buyer_id,EXISTS(SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND oi.seller_id=%s),sr.encrypted_payload
                           FROM orders o LEFT JOIN shipping_records sr ON sr.order_id=o.id WHERE o.id=%s""",(account.id,order_id))
            row=cur.fetchone()
            if not row or (row[0]!=account.id and not row[1]): raise HTTPException(403,"forbidden")
            return {"shipping":None if not row[2] else json.loads(decrypt_text(bytes(row[2])))}

@app.post("/disputes/{dispute_id}/evidence",status_code=201)
async def upload_evidence(dispute_id:UUID,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    media=request.headers.get("content-type","").split(";")[0].lower(); data=await request.body()
    try:key,size,digest,scan=store_upload(data,media,"dispute_evidence",STORAGE_ROOT)
    except Exception as exc: raise HTTPException(400,"upload_rejected") from exc
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT buyer_account_id,seller_account_id FROM disputes WHERE id=%s FOR UPDATE",(dispute_id,)); row=cur.fetchone()
            if not row or account.id not in {row[0],row[1]}: raise HTTPException(403,"forbidden")
            cur.execute("INSERT INTO uploads(owner_account_id,object_key,media_type,byte_size,sha256,purpose,scan_status) VALUES(%s,%s,%s,%s,%s,'dispute_evidence',%s) RETURNING id",(account.id,key,media,size,digest,scan))
            uid=cur.fetchone()[0]
            cur.execute("INSERT INTO dispute_evidence(dispute_id,submitted_by,object_key,media_type,byte_size,sha256,scan_status) VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING id",(dispute_id,account.id,key,media,size,digest,scan))
            eid=cur.fetchone()[0]; conn.commit()
    return {"id":str(eid),"upload_id":str(uid),"scan_status":scan}

@app.post("/admin/listings/{listing_id}/status")
async def moderate_listing(listing_id:UUID,body:ModerationStatusIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account); rid=request_id(request)
    if body.status not in {"active","paused","removed","blocked"}: raise HTTPException(400,"invalid_listing_status")
    with connection() as conn:
        with conn.cursor() as cur:
            require_permission(cur,account,"listings.manage",rid,"listing",listing_id)
            cur.execute("SELECT status FROM listings WHERE id=%s FOR UPDATE",(listing_id,)); row=cur.fetchone()
            if not row: raise HTTPException(404,"not_found")
            cur.execute("UPDATE listings SET status=%s,updated_at=now() WHERE id=%s",(body.status,listing_id))
            audit(cur,account.id,"listing.moderate","listing",listing_id,"allowed",body.reason,rid); conn.commit()
    return {"status":body.status}

@app.post("/admin/users/{account_id}/status")
async def moderate_account(account_id:UUID,body:ModerationStatusIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account); rid=request_id(request)
    if body.status not in {"active","suspended","closed"}: raise HTTPException(400,"invalid_account_status")
    if account_id==account.id: raise HTTPException(403,"self_action_forbidden")
    with connection() as conn:
        with conn.cursor() as cur:
            require_permission(cur,account,"users.manage",rid,"account",account_id)
            cur.execute("SELECT status FROM accounts WHERE id=%s FOR UPDATE",(account_id,)); row=cur.fetchone()
            if not row: raise HTTPException(404,"not_found")
            cur.execute("UPDATE accounts SET status=%s,updated_at=now() WHERE id=%s",(body.status,account_id))
            if body.status!="active": cur.execute("UPDATE sessions SET revoked_at=now() WHERE account_id=%s AND revoked_at IS NULL",(account_id,))
            audit(cur,account.id,"account.moderate","account",account_id,"allowed",body.reason,rid); conn.commit()
    return {"status":body.status}

@app.post("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id:UUID,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE notifications SET read_at=now() WHERE id=%s AND account_id=%s",(notification_id,account.id)); conn.commit()
    return {"status":"read"}

def _verify_admin_mfa(cur,account_id:UUID,code:str)->bool:
    cur.execute("SELECT encrypted_secret FROM admin_mfa_credentials WHERE account_id=%s",(account_id,))
    row=cur.fetchone()
    return bool(row and verify_code(decrypt_secret(bytes(row[0])),code))

def _admin_password_hash(account_id:UUID)->str:
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT password_hash FROM accounts WHERE id=%s",(account_id,))
            row=cur.fetchone()
    if not row: return "!"
    return str(row[0])
