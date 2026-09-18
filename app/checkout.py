from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from inventory import ReservationResult, reserve_inventory
from orders import CartLine


@dataclass(frozen=True)
class ReservationSummary:
    reserved_lines: int
    reserved_units: int


def reserve_cart(cur, lines: list[CartLine]) -> ReservationSummary:
    if not lines:
        raise ValueError("empty_cart")

    ordered = sorted(lines, key=lambda line: line.listing_id.bytes)
    reserved_units = 0

    for line in ordered:
        result = reserve_inventory(cur, line.listing_id, line.quantity)
        if result is not ReservationResult.RESERVED:
            raise ValueError("insufficient_stock")
        reserved_units += line.quantity

    return ReservationSummary(
        reserved_lines=len(ordered),
        reserved_units=reserved_units,
    )


def assert_listing_owner(listing_seller_id: UUID, requested_seller_id: UUID) -> None:
    if listing_seller_id != requested_seller_id:
        raise PermissionError("listing_owner_mismatch")
