from __future__ import annotations
from decimal import Decimal
from uuid import UUID

def seller_metrics(cur,seller_id:UUID)->tuple[int,int,int]:
    cur.execute("""SELECT COALESCE(points,0) FROM seller_point_balances WHERE seller_account_id=%s""",(seller_id,))
    row=cur.fetchone(); points=int(row[0]) if row else 0
    cur.execute("""SELECT COUNT(DISTINCT order_id) FROM order_items oi JOIN orders o ON o.id=oi.order_id
                   WHERE oi.seller_id=%s AND o.status='completed'""",(seller_id,))
    completed=int(cur.fetchone()[0])
    cur.execute("""SELECT COUNT(DISTINCT d.id) FROM disputes d
                   WHERE d.seller_account_id=%s AND d.status IN('open','awaiting_buyer','awaiting_seller','under_review','mediation','appealed','resolved','closed')""",(seller_id,))
    disputes=int(cur.fetchone()[0])
    rate_bps=10000 if completed==0 and disputes>0 else int((Decimal(disputes)*Decimal(10000)/Decimal(completed)).to_integral_value()) if completed else 0
    return points,completed,min(max(rate_bps,0),10000)

def current_level(cur,seller_id:UUID):
    points,completed,rate=seller_metrics(cur,seller_id)
    cur.execute("""SELECT level,name,min_points,min_completed_sales,max_dispute_rate_bps,advance_payout_allowed
                   FROM seller_point_levels WHERE active=true ORDER BY level DESC""")
    for row in cur.fetchall():
        if points>=int(row[2]) and completed>=int(row[3]) and rate<=int(row[4]):
            return {"level":int(row[0]),"name":row[1],"points":points,"completed_sales":completed,"dispute_rate_bps":rate,"advance_payout_allowed":bool(row[5])}
    return {"level":0,"name":"Nuevo","points":points,"completed_sales":completed,"dispute_rate_bps":rate,"advance_payout_allowed":False}
