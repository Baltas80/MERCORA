from __future__ import annotations
from collections import defaultdict
from time import monotonic

class FixedWindowRateLimiter:
    def __init__(self, limit: int, window_seconds: float) -> None:
        if limit <= 0 or window_seconds <= 0:
            raise ValueError("invalid_rate_limit")
        self.limit = limit
        self.window_seconds = window_seconds
        self._windows: dict[str, tuple[float, int]] = defaultdict(lambda: (0.0, 0))

    def allow(self, key: str) -> bool:
        now = monotonic()
        started, count = self._windows[key]
        if now - started >= self.window_seconds:
            self._windows[key] = (now, 1)
            return True
        if count >= self.limit:
            return False
        self._windows[key] = (started, count + 1)
        return True

    def clear(self, key: str) -> None:
        self._windows.pop(key, None)
