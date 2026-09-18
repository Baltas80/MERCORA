from passwords import hash_password, verify_password


def test_password_hash_is_not_plaintext():
    password = "correct horse battery staple"
    encoded = hash_password(password)
    assert encoded != password
    assert encoded.startswith("$argon2id$")


def test_password_verification():
    encoded = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", encoded)
    assert not verify_password("wrong password", encoded)


def test_same_password_gets_distinct_hashes():
    first = hash_password("same password")
    second = hash_password("same password")
    assert first != second
