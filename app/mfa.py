from __future__ import annotations
import pyotp
from crypto_box import decrypt_text, encrypt_text

def generate_secret()->str:
    return pyotp.random_base32()

def provisioning_uri(secret:str, account_name:str)->str:
    return pyotp.TOTP(secret).provisioning_uri(name=account_name, issuer_name="MERCORA")

def verify_code(secret:str, code:str)->bool:
    if not isinstance(code,str) or not code.isdigit() or len(code)!=6:
        return False
    return pyotp.TOTP(secret).verify(code, valid_window=1)

def encrypt_secret(secret:str)->bytes:
    return encrypt_text(secret)

def decrypt_secret(blob:bytes)->str:
    return decrypt_text(blob)
