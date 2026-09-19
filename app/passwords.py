from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError

_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4, hash_len=32, salt_len=16)

def hash_password(password: str) -> str:
    if not isinstance(password, str) or not password or len(password) > 1024:
        raise ValueError("password_required")
    return _hasher.hash(password)

def verify_password(password: str, encoded_hash: str) -> bool:
    if not isinstance(password, str) or not isinstance(encoded_hash, str) or not password or not encoded_hash:
        return False
    try:
        return _hasher.verify(encoded_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False
