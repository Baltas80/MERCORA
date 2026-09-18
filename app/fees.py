from __future__ import annotations

from dataclasses import dataclass


BPS_DENOMINATOR = 10_000


@dataclass(frozen=True)
class FeePolicy:
    version: int
    buyer_fee_bps: int
    seller_fee_bps: int

    def __post_init__(self) -> None:
        if self.version <= 0:
            raise ValueError("invalid_fee_policy_version")
        if not 0 <= self.buyer_fee_bps <= BPS_DENOMINATOR:
            raise ValueError("invalid_buyer_fee")
        if not 0 <= self.seller_fee_bps <= BPS_DENOMINATOR:
            raise ValueError("invalid_seller_fee")
        if self.buyer_fee_bps + self.seller_fee_bps > BPS_DENOMINATOR:
            raise ValueError("combined_fee_too_high")


@dataclass(frozen=True)
class FeeBreakdown:
    buyer_fee_minor: int
    seller_fee_minor: int


def calculate_percentage_fee(base_minor: int, fee_bps: int) -> int:
    if base_minor < 0:
        raise ValueError("invalid_base")
    if not 0 <= fee_bps <= BPS_DENOMINATOR:
        raise ValueError("invalid_fee_bps")
    return (base_minor * fee_bps + BPS_DENOMINATOR - 1) // BPS_DENOMINATOR


def calculate_fees(subtotal_minor: int, policy: FeePolicy) -> FeeBreakdown:
    return FeeBreakdown(
        buyer_fee_minor=calculate_percentage_fee(subtotal_minor, policy.buyer_fee_bps),
        seller_fee_minor=calculate_percentage_fee(subtotal_minor, policy.seller_fee_bps),
    )
