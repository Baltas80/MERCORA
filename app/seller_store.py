from __future__ import annotations
import hashlib,re,secrets
from uuid import UUID
STORE_RE=re.compile(r"^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$")
def normalize_name(v:str)->str:
    v=str(v or "").strip()
    if not 2<=len(v)<=80: raise ValueError("invalid_store_name")
    return v
def normalize_slug(v:str)->str:
    v=str(v or "").strip().lower()
    if not STORE_RE.fullmatch(v): raise ValueError("invalid_store_slug")
    return v
def generate_promo()->str: return secrets.token_urlsafe(18)
def promo_hash(code:str)->bytes:
    if len(str(code).strip())<16: raise ValueError("invalid_promo_code")
    return hashlib.sha256(str(code).strip().encode()).digest()
