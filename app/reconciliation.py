from __future__ import annotations
from decimal import Decimal
from uuid import UUID

ASSETS=("BTC","LTC","XMR")

def record_asset_reconciliation(cur,asset_code:str,network:str,onchain_atomic:int,internal_liability_atomic:int)->UUID:
    asset=asset_code.upper()
    if asset not in ASSETS or onchain_atomic<0 or internal_liability_atomic<0:
        raise ValueError("invalid_reconciliation")
    delta=Decimal(onchain_atomic)-Decimal(internal_liability_atomic)
    state="matched" if delta==0 else "mismatch"
    cur.execute("""INSERT INTO reconciliation_runs(asset_code,network,status,onchain_atomic,internal_liability_atomic,delta_atomic,finished_at)
                   VALUES(%s,%s,%s,%s,%s,%s,now()) RETURNING id""",(asset,network,state,onchain_atomic,internal_liability_atomic,delta))
    run_id=UUID(str(cur.fetchone()[0]))
    cur.execute("INSERT INTO reconciliation_items(run_id,expected_atomic,observed_atomic,status) VALUES(%s,%s,%s,%s)",
                (run_id,internal_liability_atomic,onchain_atomic,state if state in {"matched","mismatch"} else "mismatch"))
    if state=="mismatch":
        cur.execute("UPDATE system_state SET value='financial_freeze',updated_at=now() WHERE key IN('custody_mode','marketplace_mode')")
    return run_id

def all_assets_reconciled(cur)->bool:
    for asset in ASSETS:
        cur.execute("""SELECT status FROM reconciliation_runs WHERE asset_code=%s ORDER BY finished_at DESC NULLS LAST LIMIT 1""",(asset,))
        row=cur.fetchone()
        if not row or row[0]!="matched":
            return False
    return True
