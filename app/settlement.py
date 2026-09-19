from payments import PaymentStatus
def verify_payment_for_settlement(payment_status: PaymentStatus, adapter_verified: bool) -> None:
    if payment_status is not PaymentStatus.CONFIRMED:
        raise ValueError("payment_not_confirmed")
    if not adapter_verified:
        raise ValueError("adapter_verification_required")
