from __future__ import annotations
from decimal import Decimal
from uuid import UUID

def create_balanced_transaction(cur, *, asset_code:str, transaction_type:str, reference_type:str|None, reference_id:UUID|None, idempotency_key:str, lines:list[tuple[UUID,str,int]])->UUID:
    if len(lines)<2 or sum(int(x[2]) for x in lines)<=0 or sum((int(x[2]) if x[1]=="debit" else -int(x[2])) for x in lines)!=0:
        raise ValueError("ledger_transaction_not_balanced")
    cur.execute("""INSERT INTO ledger_transactions(id,idempotency_key,asset_code,transaction_type,reference_type,reference_id)
                   VALUES(gen_random_uuid(),%s,%s,%s,%s,%s)
                   ON CONFLICT(idempotency_key) DO UPDATE SET id=ledger_transactions.id
                   RETURNING id""",(idempotency_key,asset_code,transaction_type,reference_type,reference_id))
    tx_id=cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM ledger_entries WHERE transaction_id=%s",(tx_id,))
    if cur.fetchone()[0]==0:
        for account_id,direction,amount in lines:
            cur.execute("INSERT INTO ledger_entries(transaction_id,ledger_account_id,asset_code,direction,amount_atomic) VALUES(%s,%s,%s,%s,%s)",
                        (tx_id,account_id,asset_code,direction,amount))
    return UUID(str(tx_id))

def customer_liability(cur, account_id:UUID, asset_code:str)->Decimal:
    cur.execute("""SELECT COALESCE(SUM(CASE WHEN e.direction='credit' THEN e.amount_atomic ELSE -e.amount_atomic END),0)
                   FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.ledger_account_id
                   WHERE a.owner_account_id=%s AND a.account_type='customer_liability' AND e.asset_code=%s""",(account_id,asset_code))
    return Decimal(cur.fetchone()[0])

def ensure_ledger_account(cur, *, code:str, asset_code:str, account_type:str, owner_account_id:UUID|None=None)->UUID:
    cur.execute("""INSERT INTO ledger_accounts(code,asset_code,owner_account_id,account_type)
                   VALUES(%s,%s,%s,%s)
                   ON CONFLICT(code,asset_code) DO UPDATE SET owner_account_id=COALESCE(ledger_accounts.owner_account_id,EXCLUDED.owner_account_id)
                   RETURNING id""",(code,asset_code,owner_account_id,account_type))
    return UUID(str(cur.fetchone()[0]))
