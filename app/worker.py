from __future__ import annotations
import os,socket,time,traceback
from db import connection
from inventory import release_inventory

WORKER_ID=f"{socket.gethostname()}:{os.getpid()}"

def run_once()->int:
    claimed=0
    with connection() as conn:
        with conn.cursor() as cur:
            # Recover jobs whose worker lease expired before the process could finish.
            cur.execute("""UPDATE jobs
                           SET status='queued',locked_at=NULL,locked_by=NULL,
                               last_error='worker_lease_expired',run_at=now(),updated_at=now()
                           WHERE status='running'
                             AND locked_at IS NOT NULL
                             AND locked_at < now()-interval '10 minutes'""")
            cur.execute("""SELECT id,job_type,payload FROM jobs
                           WHERE status='queued' AND run_at<=now()
                           ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 20""")
            for job_id,job_type,payload in cur.fetchall():
                cur.execute("UPDATE jobs SET status='running',locked_at=now(),locked_by=%s,attempts=attempts+1,updated_at=now() WHERE id=%s",(WORKER_ID,job_id))
                claimed+=1
                try:
                    if job_type=="expire_sessions":
                        cur.execute("UPDATE sessions SET revoked_at=now() WHERE revoked_at IS NULL AND expires_at<=now()")
                    elif job_type=="expire_promos":
                        cur.execute("UPDATE promo_codes SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at<=now()")
                    elif job_type=="expire_payments":
                        cur.execute("""SELECT id,order_id FROM payment_intents
                                       WHERE status='awaiting_payment' AND expires_at IS NOT NULL AND expires_at<=now() FOR UPDATE""")
                        for pid,order_id in cur.fetchall():
                            cur.execute("UPDATE payment_intents SET status='expired',updated_at=now() WHERE id=%s AND status='awaiting_payment'",(pid,))
                            if order_id:
                                cur.execute("SELECT listing_id,quantity FROM order_items WHERE order_id=%s",(order_id,))
                                for listing_id,qty in cur.fetchall():
                                    try: release_inventory(cur,listing_id,int(qty))
                                    except ValueError: pass
                                cur.execute("UPDATE orders SET status='cancelled',updated_at=now() WHERE id=%s AND status='pending_payment'",(order_id,))
                    elif job_type=="dispute_deadlines":
                        cur.execute("""UPDATE disputes SET status='under_review',updated_at=now()
                                       WHERE status IN('awaiting_buyer','awaiting_seller')
                                         AND ((response_deadline IS NOT NULL AND response_deadline<=now())
                                           OR (decision_deadline IS NOT NULL AND decision_deadline<=now()))""")
                    delay = "1 minute" if job_type in {"expire_sessions","expire_promos"} else "30 seconds"
                    cur.execute("UPDATE jobs SET status='queued',run_at=now()+%s::interval,locked_at=NULL,locked_by=NULL,last_error=NULL,updated_at=now() WHERE id=%s",(delay,job_id))
                except Exception as exc:
                    cur.execute("UPDATE jobs SET status=CASE WHEN attempts>=5 THEN 'dead' ELSE 'queued' END,last_error=%s,run_at=now()+interval '5 minutes',updated_at=now() WHERE id=%s",(type(exc).__name__,job_id))
        conn.commit()
    return claimed

def schedule_defaults()->None:
    with connection() as conn:
        with conn.cursor() as cur:
            for job_type in ("expire_sessions","expire_promos","expire_payments","dispute_deadlines"):
                cur.execute("INSERT INTO jobs(job_type,run_at) SELECT %s,now() WHERE NOT EXISTS(SELECT 1 FROM jobs WHERE job_type=%s AND status IN('queued','running'))",(job_type,job_type))
        conn.commit()

def main():
    while True:
        try:
            schedule_defaults()
            run_once()
        except Exception:
            traceback.print_exc()
            time.sleep(5)
        time.sleep(2)

if __name__=="__main__":
    main()
