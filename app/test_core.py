import os,sys,unittest
from datetime import datetime,timezone
from uuid import uuid4
sys.path.insert(0,os.path.dirname(__file__))
from fees import FeePolicy,calculate_percentage_fee
from payments import PaymentStatus,can_transition
from dispute_policy import can_transition as dispute_can_transition,valid_decision
from seller_store import normalize_slug,promo_hash
from storage import validate_bytes

class CorePolicyTests(unittest.TestCase):
    def test_fee_rounds_up_and_policy_is_bounded(self):
        self.assertEqual(calculate_percentage_fee(101,100),2)
        with self.assertRaises(ValueError): FeePolicy(1,9000,2000)
    def test_payment_state_machine(self):
        self.assertTrue(can_transition(PaymentStatus.AWAITING_PAYMENT,PaymentStatus.CONFIRMED))
        self.assertFalse(can_transition(PaymentStatus.FAILED,PaymentStatus.CONFIRMED))
    def test_dispute_state_machine_is_fail_closed(self):
        self.assertTrue(dispute_can_transition("open","under_review"))
        self.assertFalse(dispute_can_transition("open","resolved"))
        self.assertTrue(valid_decision("no_change","The evidence does not support a financial adjustment."))
    def test_store_slug_and_promo_hash(self):
        self.assertEqual(normalize_slug("My-Store"),"my-store")
        self.assertEqual(len(promo_hash("1234567890123456")),32)
    def test_upload_signature_is_required(self):
        validate_bytes(b"\xff\xd8\xffpayload","image/jpeg")
        with self.assertRaises(ValueError): validate_bytes(b"not-an-image","image/jpeg")
if __name__=="__main__": unittest.main()
