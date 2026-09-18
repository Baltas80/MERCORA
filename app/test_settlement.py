import unittest
from uuid import uuid4

from escrow import EscrowStatus
from payments import PaymentStatus
from settlement import (
    release_credit_amount,
    validate_escrow_release,
    verify_payment_for_settlement,
)


class SettlementVerificationTests(unittest.TestCase):
    def test_unverified_payment_fails_closed(self):
        with self.assertRaises(ValueError):
            verify_payment_for_settlement(PaymentStatus.CONFIRMED, False)

    def test_non_confirmed_payment_cannot_settle(self):
        with self.assertRaises(ValueError):
            verify_payment_for_settlement(PaymentStatus.CONFIRMING, True)

    def test_confirmed_verified_payment_is_accepted(self):
        verify_payment_for_settlement(PaymentStatus.CONFIRMED, True)


class EscrowReleaseTests(unittest.TestCase):
    def test_only_held_escrow_can_enter_release_path(self):
        validate_escrow_release(EscrowStatus.HELD)

    def test_disputed_escrow_cannot_be_auto_released(self):
        with self.assertRaises(ValueError):
            validate_escrow_release(EscrowStatus.DISPUTED)

    def test_released_escrow_cannot_be_released_again(self):
        with self.assertRaises(ValueError):
            validate_escrow_release(EscrowStatus.RELEASED)

    def test_release_amount_must_be_positive(self):
        with self.assertRaises(ValueError):
            release_credit_amount(0)
        self.assertEqual(release_credit_amount(12345), 12345)


if __name__ == "__main__":
    unittest.main()
