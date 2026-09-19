import os,sys,unittest
sys.path.insert(0,os.path.dirname(__file__))
import server
class RouteTests(unittest.TestCase):
    def test_core_routes_exist(self):
        paths={getattr(r,"path",None) for r in server.app.routes}
        expected={"/healthz","/readyz","/auth/register","/auth/login","/auth/me","/auth/logout","/listings","/stores","/checkout","/payments/quote","/payments/intent","/disputes","/messages","/uploads/images","/admin/actions","/admin/emergency"}
        self.assertTrue(expected <= paths)
if __name__=="__main__": unittest.main()
