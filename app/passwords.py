from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    if not isinstance(password, str) or not password:
        raise ValueError("password_required")
    return _hasher.hash(password)


def verify_password(password: str, encoded_hash: str) -> bool:
    if not password or not encoded_hash:
        return False
    try:
        return _hasher.verify(encoded_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False
