from __future__ import annotations
import hashlib
import secrets
from uuid import UUID

def hash_code(code:str)->bytes:
    if not isinstance(code,str) or len(code)<16: raise ValueError("invalid_recovery_code")
    return hashlib.sha256(code.encode("utf-8")).digest()

def generate_codes(count:int=10)->list[str]:
    if not 5<=count<=20: raise ValueError("invalid_recovery_code_count")
    return [secrets.token_urlsafe(18) for _ in range(count)]

def use_recovery_code(cur,account_id:UUID,code:str)->bool:
    digest=hash_code(code)
    cur.execute("""SELECT id FROM recovery_codes
                   WHERE account_id=%s AND code_hash=%s AND used_at IS NULL
                   FOR UPDATE""",(account_id,digest))
    row=cur.fetchone()
    if not row: return False
    cur.execute("UPDATE recovery_codes SET used_at=now() WHERE id=%s AND used_at IS NULL",(row[0],))
    return cur.rowcount==1
