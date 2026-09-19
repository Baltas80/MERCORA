from __future__ import annotations
import hashlib,os,uuid
from io import BytesIO
from pathlib import Path
from PIL import Image
ALLOWED={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}
MAX_BYTES=10*1024*1024
def sanitize_image(data:bytes,media_type:str)->bytes:
    if media_type not in ALLOWED or not data or len(data)>MAX_BYTES: raise ValueError("upload_rejected")
    with Image.open(BytesIO(data)) as img:
        img.verify()
    with Image.open(BytesIO(data)) as img:
        if img.width>8000 or img.height>8000: raise ValueError("image_dimensions_rejected")
        out=BytesIO()
        img.convert("RGB").save(out,format={"image/jpeg":"JPEG","image/png":"PNG","image/webp":"WEBP"}[media_type],quality=90)
        return out.getvalue()
def store_clean_image(data:bytes,media_type:str,purpose:str,root:str)->tuple[str,int,str]:
    clean=sanitize_image(data,media_type)
    key=f"{purpose}/{uuid.uuid4().hex}.{ALLOWED[media_type]}"
    path=Path(root).resolve()/key
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(clean)
    return key,len(clean),hashlib.sha256(clean).hexdigest()
