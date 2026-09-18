from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum
from uuid import UUID, uuid4

from escrow import EscrowStatus, can_transition
from payments import PaymentStatus


class OrderSettlementStatus(StrEnum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    BLOCKED = "blocked"


@dataclass(frozen=True)
class SettlementDecision:
    order_id: UUID
    payment_id: UUID
    payment_status: PaymentStatus
    escrow_count: int
    seller_payout_allowed: bool


def verify_payment_for_settlement(
    payment_status: PaymentStatus,
    adapter_verified: bool,
) -> None:
    """Fail closed unless the adapter has independently verified settlement."""
    if payment_status is not PaymentStatus.CONFIRMED:
        raise ValueError("payment_not_confirmed")
    if not adapter_verified:
        raise ValueError("payment_verification_failed")


def validate_escrow_release(status: EscrowStatus) -> None:
    if status is not EscrowStatus.HELD:
        raise ValueError("escrow_not_releasable")
    if not can_transition(status, EscrowStatus.RELEASED):
        raise ValueError("escrow_release_transition_denied")


def release_credit_amount(escrow_amount_minor: int) -> int:
    if escrow_amount_minor <= 0:
        raise ValueError("escrow_amount_must_be_positive")
    return escrow_amount_minor


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def new_ledger_entry_id() -> UUID:
    return uuid4()
