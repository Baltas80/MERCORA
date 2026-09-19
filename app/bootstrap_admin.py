from __future__ import annotations
import os
from db import connection

def bootstrap() -> None:
    pseudonym=os.environ.get("MERCORA_BOOTSTRAP_ADMIN_PSEUDONYM")
    if not pseudonym:
        raise SystemExit("MERCORA_BOOTSTRAP_ADMIN_PSEUDONYM is required")
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM accounts WHERE lower(pseudonym)=lower(%s) AND status='active'",(pseudonym,))
            row=cur.fetchone()
            if not row: raise SystemExit("bootstrap_account_not_found")
            cur.execute("SELECT id FROM admin_roles WHERE name='super_admin'")
            role=cur.fetchone()
            if not role: raise SystemExit("super_admin_role_missing")
            cur.execute("""INSERT INTO admin_role_bindings(account_id,role_id,granted_by)
                           VALUES(%s,%s,%s) ON CONFLICT(account_id,role_id) DO UPDATE SET revoked_at=NULL""",
                        (row[0],role[0],row[0]))
            cur.execute("UPDATE accounts SET role='admin',updated_at=now() WHERE id=%s",(row[0],))
        conn.commit()
    print("bootstrap_admin_complete")

if __name__=="__main__":
    bootstrap()
