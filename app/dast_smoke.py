from __future__ import annotations
import json,sys,urllib.error,urllib.request

BASE=sys.argv[1] if len(sys.argv)>1 else "http://127.0.0.1:8090"

def request(path:str,method="GET",body=None):
    req=urllib.request.Request(BASE+path,method=method,data=body,headers={"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=5) as res:
            return res.status,dict(res.headers),res.read()
    except urllib.error.HTTPError as exc:
        return exc.code,dict(exc.headers),exc.read()

status,headers,_=request("/healthz")
assert status==200 and headers.get("X-Content-Type-Options")=="nosniff"
assert headers.get("Referrer-Policy")=="no-referrer"
status,_,_=request("/admin/overview")
assert status in {401,403}
status,_,_=request("/auth/me")
assert status==401
status,_,_=request("/../etc/passwd")
assert status in {400,404,301,302}
status,_,_=request("/api/does-not-exist")
assert status==404
status,_,_=request("/auth/login","POST",json.dumps({"pseudonym":"x","password":"x"}).encode())
assert status in {400,401,422,429}
print("DAST_SMOKE_OK")
