from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import StrEnum
from uuid import UUID
from fees import calculate_percentage_fee
from orders import CartLine
class EscrowStatus(StrEnum): HELD="held"; DISPUTED="disputed"; RELEASED="released"; REFUNDED="refunded"
_ALLOWED={EscrowStatus.HELD:{EscrowStatus.DISPUTED,EscrowStatus.RELEASED,EscrowStatus.REFUNDED},EscrowStatus.DISPUTED:{EscrowStatus.RELEASED,EscrowStatus.REFUNDED},EscrowStatus.RELEASED:set(),EscrowStatus.REFUNDED:set()}
@dataclass(frozen=True)
class EscrowPolicy:
    version:int; successful_orders_required:int; hold_after_delivery_seconds:int
    def requires_escrow(self, successful_orders:int)->bool: return successful_orders < self.successful_orders_required
@dataclass(frozen=True)
class EscrowAmounts: seller_gross_minor:int; seller_fee_minor:int; seller_net_minor:int
def can_transition(current:EscrowStatus,target:EscrowStatus)->bool: return target in _ALLOWED[current]
def calculate_seller_escrow_amount(lines:list[CartLine],seller_id:UUID,seller_fee_bps:int)->EscrowAmounts:
    seller_lines=[x for x in lines if x.seller_id==seller_id]
    if not seller_lines: raise ValueError("seller_has_no_order_lines")
    gross=sum(x.subtotal_minor for x in seller_lines)
    fee=sum(calculate_percentage_fee(x.subtotal_minor,seller_fee_bps) for x in seller_lines)
    return EscrowAmounts(gross,fee,gross-fee)
def release_eligible_at(delivered_at:datetime,policy:EscrowPolicy)->datetime:
    if delivered_at.tzinfo is None: raise ValueError("delivered_at_must_be_timezone_aware")
    return delivered_at+timedelta(seconds=policy.hold_after_delivery_seconds)
def utc_now(): return datetime.now(timezone.utc)
def create_funded_escrows(cur,order_id:UUID)->int:
    cur.execute("""SELECT oi.seller_id, SUM(oi.quantity*oi.unit_price_minor), MAX(o.seller_fee_minor), o.currency
                   FROM order_items oi JOIN orders o ON o.id=oi.order_id
                   WHERE oi.order_id=%s GROUP BY oi.seller_id,o.currency""",(order_id,))
    rows=cur.fetchall()
    count=0
    for seller_id,gross,total_seller_fee,currency in rows:
        cur.execute("SELECT COALESCE(SUM(amount_minor),0),COALESCE(SUM(seller_fee_minor),0) FROM seller_escrows WHERE order_id=%s AND seller_id=%s",(order_id,seller_id))
        existing=cur.fetchone()
        if existing and int(existing[0])>0: continue
        seller_fee=max(0,int(total_seller_fee or 0))
        net=int(gross)-seller_fee
        cur.execute("""INSERT INTO seller_escrows(id,order_id,seller_id,currency,amount_minor,policy_version,status)
                       SELECT gen_random_uuid(),%s,%s,%s,%s,active_policy.version,'held'
                       FROM escrow_policies active_policy WHERE active_policy.active=true
                       ON CONFLICT(order_id,seller_id) DO NOTHING""",(order_id,seller_id,currency,net))
        if cur.rowcount: 
            cur.execute("""INSERT INTO escrow_ledger_entries(id,escrow_id,order_id,seller_id,currency,entry_type,amount_minor)
                           SELECT gen_random_uuid(),id,order_id,seller_id,currency,'hold',amount_minor FROM seller_escrows
                           WHERE order_id=%s AND seller_id=%s ON CONFLICT DO NOTHING""",(order_id,seller_id))
            count+=1
    return count
