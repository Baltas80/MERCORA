from __future__ import annotations
from datetime import datetime,timedelta,timezone
from uuid import UUID
HIGH_RISK={"withdrawals.approve","payouts.approve","escrow.manage","emergency.manage"}
def create_request(cur,actor:UUID,permission:str,resource_type:str|None,resource_id:UUID|None,reason:str,ttl_minutes:int=10)->UUID:
    if permission in HIGH_RISK and len(reason.strip())<10: raise ValueError("reason_required")
    cur.execute("""INSERT INTO admin_action_requests(requested_by,permission_code,resource_type,resource_id,reason,step_up_at,expires_at)
                   VALUES(%s,%s,%s,%s,%s,now(),now()+make_interval(mins=>%s)) RETURNING id""",
                (actor,permission,resource_type,resource_id,reason.strip(),ttl_minutes))
    return UUID(str(cur.fetchone()[0]))
def approve_request(cur,action_id:UUID,approver:UUID)->bool:
    cur.execute("SELECT requested_by,status,expires_at FROM admin_action_requests WHERE id=%s FOR UPDATE",(action_id,))
    row=cur.fetchone()
    if not row or row[0]==approver or row[1]!="requested" or row[2]<=datetime.now(timezone.utc): return False
    cur.execute("INSERT INTO admin_approvals(action_request_id,approver_account_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",(action_id,approver))
    cur.execute("UPDATE admin_action_requests SET status='approved' WHERE id=%s AND EXISTS(SELECT 1 FROM admin_approvals WHERE action_request_id=%s)",(action_id,action_id))
    return cur.rowcount==1
