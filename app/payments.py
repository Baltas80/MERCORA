from __future__ import annotations
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol
from uuid import UUID

class PaymentMethod(StrEnum):
    BITCOIN="bitcoin"
    LITECOIN="litecoin"
    MONERO="monero"
    LIGHTNING="lightning"

class PaymentStatus(StrEnum):
    CREATED="created"
    AWAITING_PAYMENT="awaiting_payment"
    DETECTED="detected"
    CONFIRMING="confirming"
    CONFIRMED="confirmed"
    FAILED="failed"
    EXPIRED="expired"
    CANCELLED="cancelled"
    REFUNDED="refunded"

_ALLOWED={
 PaymentStatus.CREATED:{PaymentStatus.AWAITING_PAYMENT,PaymentStatus.CANCELLED},
 PaymentStatus.AWAITING_PAYMENT:{PaymentStatus.DETECTED,PaymentStatus.CONFIRMING,PaymentStatus.CONFIRMED,PaymentStatus.EXPIRED,PaymentStatus.CANCELLED},
 PaymentStatus.DETECTED:{PaymentStatus.CONFIRMING,PaymentStatus.CONFIRMED,PaymentStatus.FAILED},
 PaymentStatus.CONFIRMING:{PaymentStatus.CONFIRMED,PaymentStatus.FAILED},
 PaymentStatus.CONFIRMED:{PaymentStatus.REFUNDED},
 PaymentStatus.FAILED:set(),PaymentStatus.EXPIRED:set(),PaymentStatus.CANCELLED:set(),PaymentStatus.REFUNDED:set()
}
def can_transition(current:PaymentStatus,target:PaymentStatus)->bool: return current==target or target in _ALLOWED[current]
@dataclass(frozen=True)
class PaymentIntent:
    id:UUID; order_id:UUID|None; method:PaymentMethod; amount_atomic:int; asset_code:str; network:str; status:PaymentStatus
class PaymentAdapter(Protocol):
    method:PaymentMethod
    def create_intent(self,order_id:UUID|None,amount_atomic:int,asset_code:str,network:str)->PaymentIntent: ...
    def refresh_status(self,intent:PaymentIntent)->PaymentStatus: ...
    def verify_settlement(self,intent:PaymentIntent)->bool: ...
