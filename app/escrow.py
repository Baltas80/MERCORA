from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import StrEnum
from uuid import UUID

from fees import calculate_percentage_fee
from orders import CartLine


class EscrowStatus(StrEnum):
    HELD = "held"
    DISPUTED = "disputed"
    RELEASED = "released"
    REFUNDED = "refunded"


_ALLOWED_TRANSITIONS: dict[EscrowStatus, frozenset[EscrowStatus]] = {
    EscrowStatus.HELD: frozenset(
        {EscrowStatus.DISPUTED, EscrowStatus.RELEASED, EscrowStatus.REFUNDED}
    ),
    EscrowStatus.DISPUTED: frozenset(
        {EscrowStatus.RELEASED, EscrowStatus.REFUNDED}
    ),
    EscrowStatus.RELEASED: frozenset(),
    EscrowStatus.REFUNDED: frozenset(),
}


@dataclass(frozen=True)
class EscrowPolicy:
    version: int
    successful_orders_required: int
    hold_after_delivery_seconds: int

    def __post_init__(self) -> None:
        if self.version <= 0:
            raise ValueError("invalid_escrow_policy_version")
        if self.successful_orders_required < 0:
            raise ValueError("invalid_successful_orders_required")
        if self.hold_after_delivery_seconds <= 0:
            raise ValueError("invalid_hold_after_delivery_seconds")

    def requires_escrow(self, successful_orders: int) -> bool:
        if successful_orders < 0:
            raise ValueError("invalid_successful_orders")
        return successful_orders < self.successful_orders_required


@dataclass(frozen=True)
class EscrowAmounts:
    seller_gross_minor: int
    seller_fee_minor: int
    seller_net_minor: int


def can_transition(current: EscrowStatus, target: EscrowStatus) -> bool:
    return target in _ALLOWED_TRANSITIONS[current]


def calculate_seller_escrow_amount(
    lines: list[CartLine],
    seller_id: UUID,
    seller_fee_bps: int,
) -> EscrowAmounts:
    seller_lines = [line for line in lines if line.seller_id == seller_id]
    if not seller_lines:
        raise ValueError("seller_has_no_order_lines")

    gross = sum(line.subtotal_minor for line in seller_lines)
    seller_fee = sum(
        calculate_percentage_fee(line.subtotal_minor, seller_fee_bps)
        for line in seller_lines
    )
    net = gross - seller_fee
    if net < 0:
        raise ValueError("seller_net_negative")

    return EscrowAmounts(
        seller_gross_minor=gross,
        seller_fee_minor=seller_fee,
        seller_net_minor=net,
    )


def release_eligible_at(
    delivered_at: datetime,
    policy: EscrowPolicy,
) -> datetime:
    if delivered_at.tzinfo is None:
        raise ValueError("delivered_at_must_be_timezone_aware")
    return delivered_at + timedelta(seconds=policy.hold_after_delivery_seconds)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
