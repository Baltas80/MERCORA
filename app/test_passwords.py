import unittest

from passwords import hash_password, verify_password


class PasswordTests(unittest.TestCase):
    def test_password_hash_is_not_plaintext(self):
        password = "correct horse battery staple"
        encoded = hash_password(password)
        self.assertNotEqual(encoded, password)
        self.assertTrue(encoded.startswith("$argon2id$"))

    def test_password_verification(self):
        encoded = hash_password("correct horse battery staple")
        self.assertTrue(verify_password("correct horse battery staple", encoded))
        self.assertFalse(verify_password("wrong password", encoded))

    def test_same_password_gets_distinct_hashes(self):
        first = hash_password("same password")
        second = hash_password("same password")
        self.assertNotEqual(first, second)


if __name__ == "__main__":
    unittest.main()
