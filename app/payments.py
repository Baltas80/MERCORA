from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol
from uuid import UUID


class PaymentMethod(StrEnum):
    BITCOIN = "bitcoin"
    LITECOIN = "litecoin"
    MONERO = "monero"
    LIGHTNING = "lightning"


class PaymentStatus(StrEnum):
    CREATED = "created"
    AWAITING_PAYMENT = "awaiting_payment"
    DETECTED = "detected"
    CONFIRMING = "confirming"
    CONFIRMED = "confirmed"
    FAILED = "failed"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"


_ALLOWED_TRANSITIONS: dict[PaymentStatus, frozenset[PaymentStatus]] = {
    PaymentStatus.CREATED: frozenset({PaymentStatus.AWAITING_PAYMENT, PaymentStatus.CANCELLED}),
    PaymentStatus.AWAITING_PAYMENT: frozenset(
        {PaymentStatus.DETECTED, PaymentStatus.EXPIRED, PaymentStatus.CANCELLED}
    ),
    PaymentStatus.DETECTED: frozenset({PaymentStatus.CONFIRMING, PaymentStatus.FAILED}),
    PaymentStatus.CONFIRMING: frozenset({PaymentStatus.CONFIRMED, PaymentStatus.FAILED}),
    PaymentStatus.CONFIRMED: frozenset({PaymentStatus.REFUNDED}),
    PaymentStatus.FAILED: frozenset(),
    PaymentStatus.EXPIRED: frozenset(),
    PaymentStatus.CANCELLED: frozenset(),
    PaymentStatus.REFUNDED: frozenset(),
}


def can_transition(current: PaymentStatus, target: PaymentStatus) -> bool:
    return target in _ALLOWED_TRANSITIONS[current]


@dataclass(frozen=True)
class PaymentIntent:
    id: UUID
    order_id: UUID
    method: PaymentMethod
    amount_minor: int
    currency: str
    status: PaymentStatus


class PaymentAdapter(Protocol):
    method: PaymentMethod

    def create_intent(self, order_id: UUID, amount_minor: int, currency: str) -> PaymentIntent:
        ...

    def refresh_status(self, intent: PaymentIntent) -> PaymentStatus:
        ...

    def verify_settlement(self, intent: PaymentIntent) -> bool:
        ...
