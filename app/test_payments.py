import unittest
from uuid import uuid4

from payments import PaymentMethod, PaymentStatus, can_transition


class PaymentStateTests(unittest.TestCase):
    def test_payment_can_move_from_created_to_waiting(self):
        self.assertTrue(
            can_transition(PaymentStatus.CREATED, PaymentStatus.AWAITING_PAYMENT)
        )

    def test_payment_cannot_skip_confirmation(self):
        self.assertFalse(
            can_transition(PaymentStatus.DETECTED, PaymentStatus.CONFIRMED)
        )

    def test_terminal_states_cannot_be_reopened(self):
        for terminal in (
            PaymentStatus.FAILED,
            PaymentStatus.EXPIRED,
            PaymentStatus.CANCELLED,
            PaymentStatus.REFUNDED,
        ):
            self.assertFalse(
                can_transition(terminal, PaymentStatus.CONFIRMED)
            )

    def test_supported_payment_methods_are_explicit(self):
        self.assertEqual(
            {method.value for method in PaymentMethod},
            {"bitcoin", "litecoin", "monero", "lightning"},
        )


if __name__ == "__main__":
    unittest.main()
