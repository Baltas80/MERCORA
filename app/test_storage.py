import os,sys,unittest
sys.path.insert(0,os.path.dirname(__file__))
from storage import validate_pdf,sanitize_image
class StorageTests(unittest.TestCase):
    def test_pdf_signature(self):
        self.assertTrue(validate_pdf(b"%PDF-1.7 test"))
        with self.assertRaises(ValueError): validate_pdf(b"not pdf")
    def test_invalid_image_rejected(self):
        with self.assertRaises(ValueError): sanitize_image(b"not image","image/png")
