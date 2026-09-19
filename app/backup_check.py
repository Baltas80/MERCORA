from __future__ import annotations
# Production backup/restore is infrastructure-managed. This module is intentionally
# small so health checks can verify configuration without exposing backup contents.
import os
def backup_configured()->bool:
    return bool(os.environ.get("MERCORA_BACKUP_TARGET")) and bool(os.environ.get("MERCORA_BACKUP_KEY_ID"))
