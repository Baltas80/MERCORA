import os,sys,threading,unittest
from uuid import uuid4
import psycopg
sys.path.insert(0,os.path.dirname(__file__))
class InventoryConcurrencyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.url=os.environ["DATABASE_URL"]
        with psycopg.connect(cls.url) as c:
            with c.cursor() as cur:
                cur.execute("INSERT INTO accounts(pseudonym,password_hash) VALUES(%s,'test') RETURNING id",("race-"+uuid4().hex,))
                aid=cur.fetchone()[0]
                cur.execute("INSERT INTO sellers(account_id,display_name,status) VALUES(%s,%s,'active')", (aid,"race-seller-"+uuid4().hex))
                cur.execute("INSERT INTO listings(seller_id,title,description,price_minor,currency,quantity,status) VALUES(%s,'race','race item',100,'EUR',1,'active') RETURNING id",(aid,))
                cls.listing=cur.fetchone()[0]
                cur.execute("INSERT INTO listing_inventory(listing_id,available_quantity) VALUES(%s,1)",(cls.listing,))
            c.commit()
    def test_only_one_concurrent_reservation_succeeds(self):
        results=[]
        lock=threading.Lock()
        def attempt():
            ok=False
            try:
                with psycopg.connect(self.url) as c:
                    with c.cursor() as cur:
                        cur.execute("BEGIN")
                        cur.execute("SELECT available_quantity FROM listing_inventory WHERE listing_id=%s FOR UPDATE",(self.listing,))
                        n=cur.fetchone()[0]
                        if n>=1:
                            cur.execute("UPDATE listing_inventory SET available_quantity=available_quantity-1,reserved_quantity=reserved_quantity+1 WHERE listing_id=%s",(self.listing,))
                            ok=cur.rowcount==1
                        c.commit()
            except Exception:
                pass
            with lock: results.append(ok)
        threads=[threading.Thread(target=attempt) for _ in range(12)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual(results.count(True),1)
