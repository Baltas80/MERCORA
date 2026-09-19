import os,sys,unittest
sys.path.insert(0,os.path.dirname(__file__))
from mfa import generate_secret,provisioning_uri,verify_code
import pyotp
class MFATests(unittest.TestCase):
    def test_secret_uri_and_code(self):
        secret=generate_secret()
        self.assertTrue(secret)
        self.assertIn("MERCORA",provisioning_uri(secret,"admin"))
        self.assertTrue(verify_code(secret,pyotp.TOTP(secret).now()))
    def test_invalid_code_rejected(self):
        self.assertFalse(verify_code(generate_secret(),"0000000"))
