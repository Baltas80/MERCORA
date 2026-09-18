from __future__ import annotations

from enum import StrEnum
from uuid import UUID


class ReservationResult(StrEnum):
    RESERVED = "reserved"
    INSUFFICIENT_STOCK = "insufficient_stock"


def reserve_inventory(cur, listing_id: UUID, quantity: int) -> ReservationResult:
    if quantity <= 0:
        raise ValueError("invalid_quantity")

    cur.execute(
        """
        SELECT available_quantity
        FROM listing_inventory
        WHERE listing_id = %s
        FOR UPDATE
        """,
        (listing_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise LookupError("inventory_not_found")

    available = int(row[0])
    if available < quantity:
        return ReservationResult.INSUFFICIENT_STOCK

    cur.execute(
        """
        UPDATE listing_inventory
        SET available_quantity = available_quantity - %s,
            reserved_quantity = reserved_quantity + %s,
            updated_at = now()
        WHERE listing_id = %s
        """,
        (quantity, quantity, listing_id),
    )
    return ReservationResult.RESERVED


def release_inventory(cur, listing_id: UUID, quantity: int) -> None:
    if quantity <= 0:
        raise ValueError("invalid_quantity")

    cur.execute(
        """
        UPDATE listing_inventory
        SET available_quantity = available_quantity + %s,
            reserved_quantity = reserved_quantity - %s,
            updated_at = now()
        WHERE listing_id = %s
          AND reserved_quantity >= %s
        """,
        (quantity, quantity, listing_id, quantity),
    )
    if cur.rowcount != 1:
        raise ValueError("invalid_reservation_release")


def commit_inventory_sale(cur, listing_id: UUID, quantity: int) -> None:
    if quantity <= 0:
        raise ValueError("invalid_quantity")

    cur.execute(
        """
        UPDATE listing_inventory
        SET reserved_quantity = reserved_quantity - %s,
            sold_quantity = sold_quantity + %s,
            updated_at = now()
        WHERE listing_id = %s
          AND reserved_quantity >= %s
        """,
        (quantity, quantity, listing_id, quantity),
    )
    if cur.rowcount != 1:
        raise ValueError("invalid_sale_commit")
