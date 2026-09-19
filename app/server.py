from __future__ import annotations
import os,secrets
from datetime import datetime,timezone,timedelta
from typing import Annotated
from uuid import UUID,uuid4
from fastapi import Depends,FastAPI,File,Header,HTTPException,Request,Response,UploadFile,status
from pydantic import BaseModel,Field,field_validator
from auth import AuthenticatedAccount,authenticate_account,create_session,new_session_token,register_account,resolve_session,revoke_session,revoke_all_sessions,validate_pseudonym
from db import connection
from fees import FeePolicy,calculate_percentage_fee
from inventory import reserve_inventory
from seller_store import normalize_name,normalize_slug,promo_hash
from dispute_policy import can_transition,valid_decision
from security import headers,guard_size,current_account,csrf_account,request_id,require_permission,audit,financial_open
from storage import store_clean_image,MAX_BYTES
from crypto_box import encrypt_text,decrypt_text
from recovery import use_recovery_code
from ledger import customer_liability,ensure_ledger_account

app=FastAPI(title="MERCORA API",docs_url=None,redoc_url=None,openapi_url=None)
COOKIE_SECURE=os.environ.get("MERCORA_ENV","production")!="development"
SESSION_COOKIE="mercora_session"; CSRF_COOKIE="mercora_csrf"; STORAGE_ROOT=os.environ.get("MERCORA_STORAGE_ROOT","/data")

class Credentials(BaseModel):
    pseudonym:str=Field(min_length=3,max_length=32)
    password:str=Field(min_length=12,max_length=1024)
class ListingIn(BaseModel):
    category_id:UUID|None=None; title:str=Field(min_length=3,max_length=160); description:str=Field(min_length=1,max_length=10000)
    price_minor:int=Field(ge=0); currency:str=Field(min_length=3,max_length=3); quantity:int=Field(ge=1,le=100000)
    @field_validator("currency")
    @classmethod
    def currency_upper(cls,v): return v.upper()
class CartItemIn(BaseModel):
    listing_id:UUID; quantity:int=Field(ge=1,le=99)
class CheckoutIn(BaseModel):
    items:list[CartItemIn]=Field(min_length=1,max_length=50)
    idempotency_key:str=Field(min_length=16,max_length=128)
class StoreIn(BaseModel):
    store_name:str=Field(min_length=2,max_length=80); store_slug:str=Field(min_length=3,max_length=80); asset_code:str=Field(default="BTC")
    promo_code:str|None=Field(default=None,max_length=128)
class DisputeIn(BaseModel):
    order_id:UUID; seller_account_id:UUID; reason_code:str; description:str=Field(min_length=10,max_length=10000)
class MessageIn(BaseModel):
    recipient_account_id:UUID; body:str=Field(min_length=1,max_length=10000)
class DecisionIn(BaseModel):
    outcome:str; rationale:str=Field(min_length=10,max_length=10000); refund_atomic:int|None=Field(default=None,ge=0); seller_release_atomic:int|None=Field(default=None,ge=0); asset_code:str|None=None
class EmergencyIn(BaseModel):
    reason:str=Field(min_length=10,max_length=2000)
class RecoveryReset(BaseModel):
    pseudonym:str; recovery_code:str; new_password:str=Field(min_length=12,max_length=1024)

@app.middleware("http")
async def middleware(request:Request,call_next):
    try: guard_size(request); response=await call_next(request)
    except HTTPException as exc: response=Response('{"error":"request_rejected"}',status_code=exc.status_code,media_type="application/json")
    headers(response); response.headers["X-Request-ID"]=request_id(request); return response

@app.get("/healthz")
def healthz(): return {"status":"ok"}
@app.get("/readyz")
def readyz():
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1"); cur.fetchone()
    return {"status":"ready"}
@app.post("/auth/register",status_code=201)
def register(c:Credentials):
    try:
        with connection() as conn:
            account,codes=register_account(conn,c.pseudonym,c.password)
            conn.commit()
        return {"pseudonym":account.pseudonym,"recovery_codes":codes}
    except ValueError as exc: raise HTTPException(400,str(exc))
    except Exception as exc:
        if "unique" in str(exc).lower(): raise HTTPException(409,"pseudonym_unavailable")
        raise
@app.post("/auth/login")
def login(c:Credentials,response:Response):
    with connection() as conn:
        account=authenticate_account(conn,c.pseudonym,c.password)
        if account is None: raise HTTPException(401,"invalid_credentials")
        revoke_all_sessions(conn,account.id)
        token=create_session(conn,account.id); conn.commit()
    csrf=new_session_token(); response.set_cookie(SESSION_COOKIE,token,httponly=True,secure=COOKIE_SECURE,samesite="strict",path="/",max_age=8*60*60)
    response.set_cookie(CSRF_COOKIE,csrf,httponly=False,secure=COOKIE_SECURE,samesite="strict",path="/",max_age=8*60*60)
    return {"pseudonym":account.pseudonym,"role":account.role}
@app.get("/auth/me")
async def me(account:Annotated[AuthenticatedAccount,Depends(current_account)]): return {"pseudonym":account.pseudonym,"role":account.role}
@app.post("/auth/logout")
async def logout(request:Request,response:Response,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    token=request.cookies.get(SESSION_COOKIE)
    with connection() as conn:
        revoke_session(conn,token); conn.commit()
    response.delete_cookie(SESSION_COOKIE,path="/"); response.delete_cookie(CSRF_COOKIE,path="/"); return {"status":"logged_out"}
@app.post("/auth/recovery/reset")
def recovery_reset(c:RecoveryReset):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM accounts WHERE lower(pseudonym)=lower(%s) AND status<>'closed' LIMIT 1",(c.pseudonym,))
            row=cur.fetchone()
            if not row or not use_recovery_code(cur,row[0],c.recovery_code): raise HTTPException(400,"invalid_recovery")
            from passwords import hash_password
            cur.execute("UPDATE accounts SET password_hash=%s,updated_at=now() WHERE id=%s",(hash_password(c.new_password),row[0]))
            revoke_all_sessions(conn,UUID(str(row[0]))); conn.commit()
    return {"status":"password_reset"}

@app.get("/listings")
def listings(q:str|None=None,category_id:UUID|None=None,limit:int=50,offset:int=0):
    limit=min(max(limit,1),100); offset=max(offset,0)
    clauses=["l.status='active'"]; params=[]
    if q:
        clauses.append("(l.title ILIKE %s OR l.description ILIKE %s)"); params.extend([f"%{q[:120]}%",f"%{q[:120]}%"])
    if category_id: clauses.append("l.category_id=%s"); params.append(category_id)
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(f"""SELECT l.id,l.seller_id,l.category_id,l.title,l.description,l.price_minor,l.currency,i.available_quantity
                           FROM listings l JOIN listing_inventory i ON i.listing_id=l.id
                           WHERE {' AND '.join(clauses)} ORDER BY l.created_at DESC LIMIT %s OFFSET %s""",params+[limit,offset])
            return {"items":[{"id":str(r[0]),"seller_id":str(r[1]),"category_id":str(r[2]) if r[2] else None,"title":r[3],"description":r[4],"price_minor":r[5],"currency":r[6],"available_quantity":r[7]} for r in cur.fetchall()]}
@app.post("/listings",status_code=201)
async def create_listing(body:ListingIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT status FROM sellers WHERE account_id=%s",(account.id,)); s=cur.fetchone()
            if not s or s[0]!="active": raise HTTPException(403,"seller_not_active")
            cur.execute("""INSERT INTO listings(seller_id,category_id,title,description,price_minor,currency,quantity,status)
                           VALUES(%s,%s,%s,%s,%s,%s,%s,'active') RETURNING id""",
                        (account.id,body.category_id,body.title.strip(),body.description.strip(),body.price_minor,body.currency,body.quantity))
            lid=cur.fetchone()[0]
            cur.execute("INSERT INTO listing_inventory(listing_id,available_quantity) VALUES(%s,%s)",(lid,body.quantity)); conn.commit()
    return {"id":str(lid)}
@app.post("/stores",status_code=202)
async def create_store(body:StoreIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    store_name=normalize_name(body.store_name); slug=normalize_slug(body.store_slug); asset=body.asset_code.upper()
    if asset not in {"BTC","LTC","XMR"}: raise HTTPException(400,"unsupported_asset")
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM seller_stores WHERE account_id=%s",(account.id,))
            if cur.fetchone(): raise HTTPException(409,"seller_store_exists")
            if body.promo_code:
                cur.execute("SELECT id,benefit_type,benefit_asset_code,benefit_atomic,benefit_percent,max_uses,used_count FROM promo_codes WHERE code_hash=%s AND status='active' AND valid_from<=now() AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE",(promo_hash(body.promo_code),))
                promo=cur.fetchone()
                if not promo or promo[6]>=promo[5]: raise HTTPException(400,"invalid_promo")
                if promo[1]=="free_store":
                    cur.execute("""INSERT INTO seller_store_activations(account_id,requested_store_name,requested_store_slug,source,payment_status,promo_code_id,status)
                                   VALUES(%s,%s,%s,'promo','not_required',%s,'pending') RETURNING id""",(account.id,store_name,slug,promo[0]))
                    aid=cur.fetchone()[0]
                    cur.execute("INSERT INTO promo_code_redemptions(promo_code_id,account_id,activation_id) VALUES(%s,%s,%s)",(promo[0],account.id,aid))
                    cur.execute("UPDATE promo_codes SET used_count=used_count+1,status=CASE WHEN used_count+1>=max_uses THEN 'exhausted' ELSE status END WHERE id=%s",(promo[0],))
                    cur.execute("""SELECT id FROM seller_stores WHERE account_id=%s""",(account.id,))
                    cur.execute("""INSERT INTO seller_stores(account_id,store_name,store_slug,status,activation_source,activation_code_id,activated_at)
                                   VALUES(%s,%s,%s,'active','promo',%s,now()) RETURNING id""",(account.id,store_name,slug,promo[0]))
                    store_id=cur.fetchone()[0]
                    cur.execute("INSERT INTO sellers(account_id,display_name,status,activated_at) VALUES(%s,%s,'active',now()) ON CONFLICT(account_id) DO UPDATE SET status='active',activated_at=now()",(account.id,store_name))
                    cur.execute("UPDATE accounts SET role='seller',updated_at=now() WHERE id=%s",(account.id,))
                    cur.execute("UPDATE seller_store_activations SET status='activated',updated_at=now() WHERE id=%s",(aid,)); conn.commit()
                    return {"status":"activated","store_id":str(store_id)}
            cur.execute("SELECT fee_atomic FROM seller_fee_rules WHERE asset_code=%s AND active=true",(asset,))
            fee=cur.fetchone()
            if not fee: raise HTTPException(503,"seller_fee_not_configured")
            cur.execute("""INSERT INTO seller_store_activations(account_id,requested_store_name,requested_store_slug,source,fee_asset_code,fee_snapshot_atomic,status)
                           VALUES(%s,%s,%s,'paid',%s,%s,'pending') RETURNING id""",(account.id,store_name,slug,asset,fee[0]))
            aid=cur.fetchone()[0]
            cur.execute("INSERT INTO sellers(account_id,display_name,status) VALUES(%s,%s,'pending') ON CONFLICT(account_id) DO NOTHING",(account.id,store_name)); conn.commit()
    return {"status":"payment_required","activation_id":str(aid),"fee_atomic":str(fee[0]),"asset_code":asset}

@app.get("/stores/me")
async def my_store(account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id,store_name,store_slug,status,activation_source,activated_at FROM seller_stores WHERE account_id=%s",(account.id,))
            r=cur.fetchone()
            return {"store":None if not r else {"id":str(r[0]),"name":r[1],"slug":r[2],"status":r[3],"source":r[4],"activated_at":r[5]}}

@app.post("/cart")
async def add_cart(body:CartItemIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO carts(account_id) VALUES(%s) ON CONFLICT(account_id) DO NOTHING",(account.id,))
            cur.execute("INSERT INTO cart_items(cart_id,listing_id,quantity) VALUES(%s,%s,%s) ON CONFLICT(cart_id,listing_id) DO UPDATE SET quantity=LEAST(99,cart_items.quantity+EXCLUDED.quantity)",(account.id,body.listing_id,body.quantity))
            conn.commit()
    return {"status":"ok"}

@app.get("/cart")
async def get_cart(account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT ci.listing_id,ci.quantity,l.title,l.price_minor,l.currency,l.seller_id
                           FROM cart_items ci JOIN listings l ON l.id=ci.listing_id
                           WHERE ci.cart_id=%s""",(account.id,))
            return {"items":[{"listing_id":str(r[0]),"quantity":r[1],"title":r[2],"price_minor":r[3],"currency":r[4],"seller_id":str(r[5])} for r in cur.fetchall()]}

@app.post("/checkout")
async def checkout(body:CheckoutIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    with connection() as conn:
        with conn.cursor() as cur:
            if not financial_open(cur): raise HTTPException(503,"financial_operations_frozen")
            cur.execute("""SELECT id,status,currency,buyer_fee_bps,seller_fee_bps FROM fee_policies WHERE active=true LIMIT 1""")
            fp=cur.fetchone()
            if not fp: raise HTTPException(503,"fee_policy_not_configured")
            cur.execute("""SELECT id FROM orders WHERE buyer_id=%s AND idempotency_key=%s""",(account.id,body.idempotency_key))
            existing=cur.fetchone()
            if existing: return {"order_id":str(existing[0]),"status":"existing"}
            items=sorted(body.items,key=lambda x:x.listing_id.bytes)
            subtotal=buyer_fee=seller_fee=0; currency=None; rows=[]
            for item in items:
                cur.execute("""SELECT l.id,l.seller_id,l.title,l.price_minor,l.currency,i.available_quantity
                               FROM listings l JOIN listing_inventory i ON i.listing_id=l.id
                               WHERE l.id=%s AND l.status='active' FOR UPDATE OF l,i""",(item.listing_id,))
                r=cur.fetchone()
                if not r or r[5]<item.quantity: raise HTTPException(409,"insufficient_stock")
                if currency and currency!=r[4]: raise HTTPException(400,"mixed_currency_order")
                currency=r[4]; line=r[3]*item.quantity; subtotal+=line; seller_fee+=calculate_percentage_fee(line,fp[4]); rows.append((r,item))
            buyer_fee=calculate_percentage_fee(subtotal,fp[3])
            oid=uuid4()
            cur.execute("""INSERT INTO orders(id,buyer_id,status,currency,subtotal_minor,buyer_fee_minor,seller_fee_minor,total_minor,fee_policy_version,idempotency_key)
                           VALUES(%s,%s,'pending_payment',%s,%s,%s,%s,%s,%s,%s)""",(oid,account.id,currency,subtotal,buyer_fee,seller_fee,subtotal+buyer_fee,fp[0],body.idempotency_key))
            for r,item in rows:
                cur.execute("UPDATE listing_inventory SET available_quantity=available_quantity-%s,reserved_quantity=reserved_quantity+%s,updated_at=now() WHERE listing_id=%s AND available_quantity>=%s",(item.quantity,item.quantity,item.listing_id,item.quantity))
                cur.execute("INSERT INTO order_items(order_id,listing_id,seller_id,title_snapshot,unit_price_minor,quantity,seller_fee_minor) VALUES(%s,%s,%s,%s,%s,%s,%s)",
                            (oid,item.listing_id,r[1],r[2],r[3],item.quantity,calculate_percentage_fee(r[3]*item.quantity,fp[4])))
            cur.execute("INSERT INTO order_fee_entries(order_id,side,amount_minor,policy_version) VALUES(%s,'buyer',%s,%s),(%s,'seller',%s,%s)",(oid,buyer_fee,fp[0],oid,seller_fee,fp[0]))
            cur.execute("DELETE FROM cart_items WHERE cart_id=%s",(account.id,)); conn.commit()
    return {"order_id":str(oid),"status":"pending_payment","subtotal_minor":subtotal,"buyer_fee_minor":buyer_fee,"seller_fee_minor":seller_fee,"total_minor":subtotal+buyer_fee,"currency":currency}

@app.get("/orders")
async def orders(account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id,status,currency,subtotal_minor,buyer_fee_minor,total_minor,created_at FROM orders WHERE buyer_id=%s ORDER BY created_at DESC LIMIT 100",(account.id,))
            return {"items":[{"id":str(r[0]),"status":r[1],"currency":r[2],"subtotal_minor":r[3],"buyer_fee_minor":r[4],"total_minor":r[5],"created_at":r[6]} for r in cur.fetchall()]}

@app.post("/disputes",status_code=201)
async def open_dispute(body:DisputeIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    if body.reason_code not in {"non_delivery","item_not_as_described","damaged_in_transit","suspected_counterfeit","other"}: raise HTTPException(400,"invalid_reason")
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT o.buyer_id,oi.seller_id,o.status FROM orders o JOIN order_items oi ON oi.order_id=o.id
                           WHERE o.id=%s AND oi.seller_id=%s LIMIT 1""",(body.order_id,body.seller_account_id))
            r=cur.fetchone()
            if not r or account.id not in {r[0],r[1]} or r[2] not in {"payment_confirmed","processing","shipped","delivered","completed","disputed"}: raise HTTPException(403,"dispute_not_eligible")
            cur.execute("""INSERT INTO disputes(order_id,opened_by,buyer_account_id,seller_account_id,reason_code,description,status,response_deadline,decision_deadline)
                           VALUES(%s,%s,%s,%s,%s,%s,'open',now()+interval '48 hours',now()+interval '120 hours') RETURNING id""",
                        (body.order_id,account.id,r[0],r[1],body.reason_code,body.description.strip()))
            did=cur.fetchone()[0]
            cur.execute("UPDATE orders SET status='disputed',updated_at=now() WHERE id=%s AND status<>'disputed'",(body.order_id,))
            conn.commit()
    return {"id":str(did),"status":"open"}

@app.get("/disputes/{dispute_id}")
async def dispute(dispute_id:UUID,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id,order_id,buyer_account_id,seller_account_id,reason_code,description,status,priority,assigned_to,response_deadline,decision_deadline,created_at,resolved_at FROM disputes WHERE id=%s",(dispute_id,))
            r=cur.fetchone()
            if not r or account.id not in {r[2],r[3]}:
                if not r: raise HTTPException(404,"not_found")
                require_permission(cur,account,"orders.read","dispute",dispute_id)
            cur.execute("SELECT event_type,from_status,to_status,reason_code,created_at FROM dispute_events WHERE dispute_id=%s ORDER BY created_at",(dispute_id,))
            events=cur.fetchall()
            return {"id":str(r[0]),"order_id":str(r[1]),"reason":r[4],"description":r[5],"status":r[6],"priority":r[7],"assigned_to":str(r[8]) if r[8] else None,"response_deadline":r[9],"decision_deadline":r[10],"created_at":r[11],"resolved_at":r[12],"events":[{"type":x[0],"from":x[1],"to":x[2],"reason":x[3],"created_at":x[4]} for x in events]}

@app.post("/disputes/{dispute_id}/decide")
async def decide(dispute_id:UUID,body:DecisionIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    if not valid_decision(body.outcome,body.rationale): raise HTTPException(400,"invalid_decision")
    with connection() as conn:
        with conn.cursor() as cur:
            require_permission(cur,account,"escrow.manage",request_id(request),"dispute",dispute_id)
            cur.execute("SELECT status,order_id FROM disputes WHERE id=%s FOR UPDATE",(dispute_id,)); r=cur.fetchone()
            if not r or r[0] not in {"under_review","mediation"}: raise HTTPException(409,"invalid_dispute_state")
            if body.outcome!="partial_settlement" and body.refund_atomic and body.seller_release_atomic: raise HTTPException(400,"invalid_financial_outcome")
            financial=body.outcome in {"buyer_refund","seller_release","partial_settlement"}
            cur.execute("""INSERT INTO dispute_decisions(dispute_id,decided_by,outcome,refund_atomic,seller_release_atomic,asset_code,rationale,financial_action_status)
                           VALUES(%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (dispute_id,account.id,body.outcome,body.refund_atomic,body.seller_release_atomic,body.asset_code,body.rationale,"pending" if financial else "not_required"))
            cur.execute("UPDATE disputes SET status='decided',updated_at=now() WHERE id=%s",(dispute_id,))
            cur.execute("INSERT INTO dispute_events(dispute_id,actor_account_id,event_type,from_status,to_status,reason_code,idempotency_key) VALUES(%s,%s,'decision','under_review','decided',%s,%s) ON CONFLICT DO NOTHING",(dispute_id,account.id,body.outcome,str(uuid4())))
            conn.commit()
    return {"status":"decided","financial_action":"pending" if financial else "not_required"}

@app.post("/disputes/{dispute_id}/appeal")
async def appeal(dispute_id:UUID,reason:str,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    if len(reason.strip())<10: raise HTTPException(400,"invalid_reason")
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT status,buyer_account_id,seller_account_id FROM disputes WHERE id=%s FOR UPDATE",(dispute_id,)); r=cur.fetchone()
            if not r or r[0]!="decided" or account.id not in {r[1],r[2]}: raise HTTPException(403,"appeal_not_allowed")
            cur.execute("INSERT INTO dispute_appeals(dispute_id,opened_by,reason) VALUES(%s,%s,%s) RETURNING id",(dispute_id,account.id,reason.strip()))
            aid=cur.fetchone()[0]; cur.execute("UPDATE disputes SET status='appealed',updated_at=now() WHERE id=%s",(dispute_id,)); conn.commit()
    return {"appeal_id":str(aid),"status":"open"}

@app.post("/messages")
async def message(body:MessageIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account)
    if body.recipient_account_id==account.id: raise HTTPException(400,"invalid_recipient")
    encrypted=encrypt_text(body.body)
    thread=f"{min(str(account.id),str(body.recipient_account_id))}:{max(str(account.id),str(body.recipient_account_id))}"
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM account_blocks WHERE blocker_account_id=%s AND blocked_account_id=%s",(body.recipient_account_id,account.id))
            if cur.fetchone(): raise HTTPException(403,"blocked")
            cur.execute("INSERT INTO messages(thread_key,sender_account_id,recipient_account_id,encrypted_body,encryption_version) VALUES(%s,%s,%s,%s,'v1') RETURNING id",(thread,account.id,body.recipient_account_id,encrypted))
            mid=cur.fetchone()[0]; cur.execute("INSERT INTO notifications(account_id,type,payload) VALUES(%s,'message',jsonb_build_object('message_id',%s))",(body.recipient_account_id,mid)); conn.commit()
    return {"id":str(mid)}

@app.get("/messages")
async def messages(account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id,sender_account_id,recipient_account_id,encrypted_body,created_at FROM messages WHERE sender_account_id=%s OR recipient_account_id=%s ORDER BY created_at DESC LIMIT 100",(account.id,account.id))
            return {"items":[{"id":str(r[0]),"sender_account_id":str(r[1]),"recipient_account_id":str(r[2]),"body":decrypt_text(bytes(r[3])),"created_at":r[4]} for r in cur.fetchall()]}

@app.post("/uploads/images")
async def upload_image(request:Request,file:UploadFile=File(...),account:AuthenticatedAccount=Depends(current_account)):
    await csrf_account(request,account)
    media=file.content_type or ""
    data=await file.read(MAX_BYTES+1)
    if len(data)>MAX_BYTES: raise HTTPException(413,"upload_too_large")
    try:key,size,digest=store_clean_image(data,media,"listing_image",STORAGE_ROOT)
    except Exception as exc: raise HTTPException(400,"upload_rejected") from exc
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO uploads(owner_account_id,object_key,media_type,byte_size,sha256,purpose,scan_status,metadata_json) VALUES(%s,%s,%s,%s,%s,'listing_image','clean','{}') RETURNING id",(account.id,key,media,size,digest))
            uid=cur.fetchone()[0]; conn.commit()
    return {"id":str(uid),"object_key":key}

@app.post("/admin/emergency")
async def emergency(body:EmergencyIn,request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    await csrf_account(request,account); rid=request_id(request)
    with connection() as conn:
        with conn.cursor() as cur:
            require_permission(cur,account,"emergency.manage",rid,"system")
            cur.execute("SELECT value FROM system_state WHERE key='custody_mode' FOR UPDATE")
            before=cur.fetchone()[0]
            cur.execute("UPDATE system_state SET value='emergency',updated_at=now() WHERE key IN('custody_mode','marketplace_mode')")
            cur.execute("INSERT INTO emergency_events(action,actor_account_id,reason,state_before,state_after,authorization_ref) VALUES('freeze',%s,%s,%s,'emergency',%s)",(account.id,body.reason,before,rid))
            audit(cur,account.id,"emergency.freeze","system",None,"allowed",body.reason,rid); conn.commit()
    return {"status":"emergency"}

@app.get("/admin/overview")
async def admin_overview(request:Request,account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    rid=request_id(request)
    with connection() as conn:
        with conn.cursor() as cur:
            require_permission(cur,account,"users.read",rid)
            cur.execute("SELECT count(*) FROM accounts"); users=cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM sellers WHERE status='active'"); sellers=cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM orders"); orders=cur.fetchone()[0]
            cur.execute("SELECT value FROM system_state WHERE key='custody_mode'"); custody=cur.fetchone()
            return {"users":users,"active_sellers":sellers,"orders":orders,"custody_mode":custody[0] if custody else "unknown"}

@app.get("/notifications")
async def notifications(account:Annotated[AuthenticatedAccount,Depends(current_account)]):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id,type,payload,read_at,created_at FROM notifications WHERE account_id=%s ORDER BY created_at DESC LIMIT 100",(account.id,))
            return {"items":[{"id":str(r[0]),"type":r[1],"payload":r[2],"read_at":r[3],"created_at":r[4]} for r in cur.fetchall()]}

