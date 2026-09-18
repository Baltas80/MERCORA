from __future__ import annotations

from collections import defaultdict, deque
from threading import Lock
from time import monotonic


class LoginRateLimiter:
    """Small-process limiter for the prototype; production should use shared state."""

    def __init__(self, max_attempts: int = 5, window_seconds: int = 60, max_keys: int = 10000):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self.max_keys = max_keys
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        now = monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            events = self._events[key]
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= self.max_attempts:
                return False
            events.append(now)
            if len(self._events) > self.max_keys:
                oldest_key = min(self._events, key=lambda item: self._events[item][-1] if self._events[item] else float("inf"))
                self._events.pop(oldest_key, None)
            return True
