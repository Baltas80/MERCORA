from __future__ import annotations
import json, os, socket, time
from db import connection

WORKER_ID=f"{socket.gethostname()}:{os.getpid()}"

def run_once()->int:
    claimed=0
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT id,job_type,payload
                           FROM jobs
                           WHERE status='queued' AND run_at<=now()
                           ORDER BY id
                           FOR UPDATE SKIP LOCKED LIMIT 10""")
            rows=cur.fetchall()
            for job_id,job_type,payload in rows:
                cur.execute("UPDATE jobs SET status='running',locked_at=now(),locked_by=%s,attempts=attempts+1,updated_at=now() WHERE id=%s",(WORKER_ID,job_id))
                claimed+=1
                if job_type=="expire_sessions":
                    cur.execute("UPDATE sessions SET revoked_at=now() WHERE revoked_at IS NULL AND expires_at<=now()")
                elif job_type=="expire_promos":
                    cur.execute("UPDATE promo_codes SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at<=now()")
                elif job_type=="dispute_deadlines":
                    cur.execute("""UPDATE disputes SET status='under_review',updated_at=now()
                                   WHERE status IN('awaiting_buyer','awaiting_seller') AND
                                         ((response_deadline IS NOT NULL AND response_deadline<=now()) OR
                                          (decision_deadline IS NOT NULL AND decision_deadline<=now()))""")
                cur.execute("UPDATE jobs SET status='succeeded',updated_at=now() WHERE id=%s",(job_id,))
        conn.commit()
    return claimed

def main():
    while True:
        try: run_once()
        except Exception: time.sleep(5)
        time.sleep(2)

if __name__=="__main__": main()
