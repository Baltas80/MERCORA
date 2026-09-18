from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from escrow import create_funded_escrows
from payments import PaymentStatus
from settlement import verify_payment_for_settlement


@dataclass(frozen=True)
class SettlementResult:
    payment_id: UUID
    order_id: UUID
    escrow_count: int


def confirm_payment_and_create_escrow(
    cur,
    *,
    payment_id: UUID,
    adapter_verified: bool,
) -> SettlementResult:
    """Atomically authorize a verified payment and create applicable seller escrows.

    The caller must execute this function inside the same PostgreSQL transaction as
    the payment/order state transition. It intentionally fails closed when the
    adapter has not independently verified settlement.
    """
    cur.execute(
        """
        SELECT pi.id, pi.order_id, pi.status, o.status
        FROM payment_intents pi
        JOIN orders o ON o.id = pi.order_id
        WHERE pi.id = %s
        FOR UPDATE OF pi, o
        """,
        (payment_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise ValueError("payment_intent_not_found")

    payment_status = PaymentStatus(str(row[2]))
    order_id = UUID(str(row[1]))
    order_status = str(row[3])

    verify_payment_for_settlement(payment_status, adapter_verified)

    if order_status not in {"payment_detected", "payment_confirmed"}:
        raise ValueError("order_not_settleable")

    cur.execute(
        """
        UPDATE payment_intents
        SET confirmed_at = COALESCE(confirmed_at, now()), updated_at = now()
        WHERE id = %s AND status = 'confirmed'
        RETURNING id
        """,
        (payment_id,),
    )
    if cur.fetchone() is None:
        raise ValueError("payment_confirmation_state_changed")

    cur.execute(
        """
        UPDATE orders
        SET status = 'payment_confirmed', updated_at = now()
        WHERE id = %s AND status IN ('payment_detected', 'payment_confirmed')
        RETURNING id
        """,
        (order_id,),
    )
    if cur.fetchone() is None:
        raise ValueError("order_confirmation_state_changed")

    escrow_count = create_funded_escrows(cur, order_id)
    return SettlementResult(
        payment_id=payment_id,
        order_id=order_id,
        escrow_count=escrow_count,
    )
