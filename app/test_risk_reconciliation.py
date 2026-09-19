import os,sys,unittest
sys.path.insert(0,os.path.dirname(__file__))
from reconciliation import ASSETS
class RiskSchemaTests(unittest.TestCase):
    def test_supported_assets(self):
        self.assertEqual(ASSETS,("BTC","LTC","XMR"))
if __name__=="__main__": unittest.main()
