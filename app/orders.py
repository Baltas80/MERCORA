from __future__ import annotations
from dataclasses import dataclass
from uuid import UUID, uuid4
from fees import FeePolicy, calculate_percentage_fee
@dataclass(frozen=True)
class CartLine:
    listing_id: UUID
    seller_id: UUID
    unit_price_minor: int
    quantity: int
    currency: str
    @property
    def subtotal_minor(self) -> int:
        if self.unit_price_minor < 0 or self.quantity <= 0 or len(self.currency) != 3:
            raise ValueError("invalid_cart_line")
        return self.unit_price_minor * self.quantity
@dataclass(frozen=True)
class OrderAmounts:
    subtotal_minor: int
    buyer_fee_minor: int
    seller_fee_minor: int
    total_minor: int
def calculate_order_amounts(lines: list[CartLine], policy: FeePolicy) -> OrderAmounts:
    if not lines:
        raise ValueError("empty_cart")
    currencies = {line.currency.upper() for line in lines}
    if len(currencies) != 1:
        raise ValueError("mixed_currency_order")
    subtotal = sum(line.subtotal_minor for line in lines)
    buyer_fee = calculate_percentage_fee(subtotal, policy.buyer_fee_bps)
    seller_fee = sum(calculate_percentage_fee(line.subtotal_minor, policy.seller_fee_bps) for line in lines)
    return OrderAmounts(subtotal, buyer_fee, seller_fee, subtotal + buyer_fee)
def prepare_order(lines: list[CartLine], policy: FeePolicy):
    return uuid4(), calculate_order_amounts(lines, policy)
