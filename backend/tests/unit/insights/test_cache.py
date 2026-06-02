"""Unit tests for ``insights.cache``.

Three behaviors under test:

1. ``get_or_compute`` memoizes — the compute function fires once per
   key within the TTL window.
2. ``invalidate_for_teacher`` drops only that teacher's entries.
3. TTL expiry — entries vanish after the configured lifetime.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime

from insights.cache import InsightsCache, make_key


def _ts(year: int = 2026, month: int = 6, day: int = 1) -> datetime:
    return datetime(year, month, day, tzinfo=UTC)


def test_get_or_compute_memoizes_within_ttl() -> None:
    cache = InsightsCache(ttl_seconds=60.0)
    key = make_key(teacher_uid="t1", surface="summary", since=_ts(), until=_ts(day=8))
    calls = {"n": 0}

    def _compute() -> dict:
        calls["n"] += 1
        return {"value": 42}

    first = cache.get_or_compute(key, _compute)
    second = cache.get_or_compute(key, _compute)

    assert first == second == {"value": 42}
    assert calls["n"] == 1  # second call was a cache HIT


def test_invalidate_for_teacher_scoped() -> None:
    cache = InsightsCache()
    key_t1 = make_key(teacher_uid="t1", surface="summary", since=_ts(), until=_ts(day=8))
    key_t2 = make_key(teacher_uid="t2", surface="summary", since=_ts(), until=_ts(day=8))
    cache.set(key_t1, "t1-data")
    cache.set(key_t2, "t2-data")

    dropped = cache.invalidate_for_teacher("t1")

    assert dropped == 1
    assert cache.get(key_t1) is None
    assert cache.get(key_t2) == "t2-data"


def test_invalidate_returns_zero_when_nothing_to_drop() -> None:
    cache = InsightsCache()
    assert cache.invalidate_for_teacher("ghost") == 0


def test_ttl_expiry() -> None:
    cache = InsightsCache(ttl_seconds=0.01)  # 10ms TTL
    key = make_key(teacher_uid="t1", surface="summary", since=_ts(), until=_ts(day=8))
    cache.set(key, "fresh")
    assert cache.get(key) == "fresh"
    time.sleep(0.02)
    assert cache.get(key) is None  # expired -> miss


def test_clear_drops_everything() -> None:
    cache = InsightsCache()
    cache.set(make_key(teacher_uid="t1", surface="a", since=_ts(), until=_ts(day=2)), 1)
    cache.set(make_key(teacher_uid="t2", surface="b", since=_ts(), until=_ts(day=2)), 2)
    assert cache.size() == 2
    cache.clear()
    assert cache.size() == 0


def test_make_key_strips_microseconds() -> None:
    a = make_key(
        teacher_uid="t",
        surface="s",
        since=datetime(2026, 6, 1, 12, 0, 0, 123_000, tzinfo=UTC),
        until=datetime(2026, 6, 1, 13, 0, 0, 999_000, tzinfo=UTC),
    )
    b = make_key(
        teacher_uid="t",
        surface="s",
        since=datetime(2026, 6, 1, 12, 0, 0, 999_000, tzinfo=UTC),
        until=datetime(2026, 6, 1, 13, 0, 0, 1_000, tzinfo=UTC),
    )
    assert a == b  # microseconds normalised out
