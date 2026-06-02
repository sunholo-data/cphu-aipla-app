"""In-memory TTL cache for insights aggregates.

60-second TTL keyed on ``(teacher_uid, surface, since_iso, until_iso)``.
The TTL is short on purpose: teachers navigating between classes get
instant repeated loads, but data is never stale enough to be wrong.

Trivial dict-based implementation — Redis would be overkill for a
single-tenant Cloud Run instance whose process restarts on deploy.
The cache is per-process; that's a feature, not a bug, for a low-volume
dashboard. When AIPLA grows past a single instance, swap the backing
store; the key/value contract stays the same.

The :func:`invalidate_for_teacher` hook lets the ``/api/classes/*``
PATCH path drop a teacher's entries when class membership changes —
otherwise a teacher could PATCH a class and see the old KPI strip for
up to 60 seconds.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from datetime import datetime
from typing import Any

log = logging.getLogger(__name__)

#: Cache lifetime in seconds. Bumping this above 60s starts trading
#: dashboard freshness for cost; below 30s makes the cache near-useless
#: for typical click-around-the-classes-page navigation.
DEFAULT_TTL_SECONDS = 60.0


CacheKey = tuple[str, str, str, str]


def _iso(ts: datetime) -> str:
    """Stable string form for cache-key timestamps. Microsecond
    differences across cache lookups would defeat the cache; round to
    the second."""
    return ts.replace(microsecond=0).isoformat()


def make_key(*, teacher_uid: str, surface: str, since: datetime, until: datetime) -> CacheKey:
    """Cache key for an insights aggregate call.

    ``surface`` is a free-form discriminator (e.g. ``"summary"``,
    ``"class_kpis:abc"``) — the caller decides the granularity. Pick
    something class-id-specific for per-class aggregates so one class
    invalidation doesn't blow away the whole teacher's cache.
    """
    return (teacher_uid, surface, _iso(since), _iso(until))


class InsightsCache:
    """Thread-safe in-process TTL cache.

    Not a subclass of ``functools.lru_cache``: we need per-teacher
    invalidation (drop all keys whose first tuple element matches a
    teacher uid), which the stdlib LRU does not support cleanly.
    """

    def __init__(self, ttl_seconds: float = DEFAULT_TTL_SECONDS) -> None:
        self._ttl = ttl_seconds
        self._lock = threading.RLock()
        self._store: dict[CacheKey, tuple[float, Any]] = {}

    def get(self, key: CacheKey) -> Any | None:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            expires_at, value = entry
            if expires_at < time.monotonic():
                # Expired — clear and miss.
                self._store.pop(key, None)
                return None
            return value

    def set(self, key: CacheKey, value: Any) -> None:
        with self._lock:
            self._store[key] = (time.monotonic() + self._ttl, value)

    def get_or_compute(self, key: CacheKey, compute: Callable[[], Any]) -> Any:
        """Memoize ``compute()`` under ``key``. Records a hit/miss
        debug log so we can tell from Cloud Logging whether the cache
        is doing anything."""
        cached = self.get(key)
        if cached is not None:
            log.debug("insights_cache: HIT key=%s", key)
            return cached
        log.debug("insights_cache: MISS key=%s", key)
        value = compute()
        self.set(key, value)
        return value

    def invalidate_for_teacher(self, teacher_uid: str) -> int:
        """Drop every entry whose first key element matches
        ``teacher_uid``. Returns the count for observability — useful
        in the PATCH /api/classes log line to confirm invalidation
        actually fired."""
        with self._lock:
            stale = [k for k in self._store if k[0] == teacher_uid]
            for k in stale:
                self._store.pop(k, None)
        if stale:
            log.info("insights_cache: invalidated %d keys for teacher=%s", len(stale), teacher_uid)
        return len(stale)

    def clear(self) -> None:
        """Drop everything. Used by tests."""
        with self._lock:
            self._store.clear()

    def size(self) -> int:
        with self._lock:
            return len(self._store)


#: Process-wide singleton. Routes call ``CACHE.get_or_compute(...)``
#: rather than constructing their own instance — sharing is the whole
#: point of the cache.
CACHE = InsightsCache()


__all__ = [
    "CACHE",
    "DEFAULT_TTL_SECONDS",
    "CacheKey",
    "InsightsCache",
    "make_key",
]
