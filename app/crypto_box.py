from __future__ import annotations
import base64
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ENV_KEY="MERCORA_ENCRYPTION_KEY_B64"

def _key() -> bytes:
    raw=os.environ.get(ENV_KEY)
    if not raw:
        raise RuntimeError(f"{ENV_KEY} is required")
    try:
        key=base64.b64decode(raw,validate=True)
    except Exception as exc:
        raise RuntimeError("invalid_encryption_key") from exc
    if len(key)!=32:
        raise RuntimeError("encryption_key_must_be_32_bytes")
    return key

def encrypt_text(value: str) -> bytes:
    if not isinstance(value,str) or not value or len(value)>20000:
        raise ValueError("invalid_plaintext")
    nonce=os.urandom(12)
    ciphertext=AESGCM(_key()).encrypt(nonce,value.encode("utf-8"),None)
    return b"v1:"+nonce+ciphertext

def decrypt_text(blob: bytes) -> str:
    if not isinstance(blob,(bytes,bytearray)) or not blob.startswith(b"v1:"):
        raise ValueError("invalid_ciphertext")
    nonce=bytes(blob[3:15])
    ciphertext=bytes(blob[15:])
    return AESGCM(_key()).decrypt(nonce,ciphertext,None).decode("utf-8")
