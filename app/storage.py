from __future__ import annotations

import hashlib
import uuid
from io import BytesIO
from pathlib import Path

from PIL import Image

IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
PDF = "application/pdf"
MAX_BYTES = 10 * 1024 * 1024


def validate_bytes(data: bytes, media_type: str) -> None:
    if not isinstance(data, bytes) or not data or len(data) > MAX_BYTES:
        raise ValueError("upload_rejected")
    if media_type in IMAGE_TYPES:
        try:
            with Image.open(BytesIO(data)) as img:
                img.verify()
            with Image.open(BytesIO(data)) as img:
                if img.width > 8000 or img.height > 8000:
                    raise ValueError("image_dimensions_rejected")
                if img.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("upload_rejected")
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("upload_rejected") from exc
        return
    if media_type == PDF:
        # This is only a structural gate. Production PDF uploads still require
        # an isolated malware/AV pipeline and resource limits before delivery.
        stripped = data.rstrip()
        if (
            not stripped.startswith(b"%PDF-")
            or not stripped.endswith(b"%%EOF")
            or b"startxref" not in stripped
            or b"trailer" not in stripped
        ):
            raise ValueError("upload_rejected")
        return
    raise ValueError("upload_type_invalid")


def sanitize_image(data: bytes, media_type: str) -> bytes:
    validate_bytes(data, media_type)
    out = BytesIO()
    with Image.open(BytesIO(data)) as img:
        img.convert("RGB").save(
            out,
            format={"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}[media_type],
            quality=90,
        )
    return out.getvalue()


def validate_pdf(data: bytes) -> bytes:
    validate_bytes(data, PDF)
    return bytes(data)


def store_upload(data: bytes, media_type: str, purpose: str, root: str) -> tuple[str, int, str, str]:
    if media_type in IMAGE_TYPES:
        clean = sanitize_image(data, media_type)
        ext = IMAGE_TYPES[media_type]
    elif media_type == PDF:
        clean = validate_pdf(data)
        ext = "pdf"
    else:
        raise ValueError("upload_type_invalid")

    scan = "pending"
    key = f"{purpose}/{uuid.uuid4().hex}.{ext}"
    path = Path(root).resolve() / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(clean)
    return key, len(clean), hashlib.sha256(clean).hexdigest(), scan


def store_clean_image(data: bytes, media_type: str, purpose: str, root: str):
    key, size, digest, _ = store_upload(data, media_type, purpose, root)
    return key, size, digest
