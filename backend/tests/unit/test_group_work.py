"""1.1.161 M1 — the per-group work / page-open stamp."""

from __future__ import annotations

import pytest

from db import firestore as fs_module
from db import group_work
from db.group_work import kind_for_server, read_work, touch_seen, touch_work


@pytest.fixture(autouse=True)
def _local(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    group_work._reset_throttle_for_tests()
    yield
    fs_module._reset_client_for_testing()
    group_work._reset_throttle_for_tests()


def test_stamps_round_trip():
    touch_work("g-1", "table")
    touch_seen("g-1")
    got = read_work(["g-1", "g-none"])
    assert set(got) == {"g-1"}
    assert got["g-1"]["last_work_kind"] == "table"
    assert got["g-1"]["last_work_at"] is not None and got["g-1"]["last_seen_at"] is not None


def test_throttled_per_group_and_kind(monkeypatch):
    calls = []
    monkeypatch.setattr(group_work, "set_document", lambda *a, **k: calls.append(a[2]))
    for _ in range(5):
        touch_work("g", "writing")
    touch_work("g", "sim")  # a different kind is seen at once
    touch_work("other", "writing")  # a different group too
    assert [c["lastWorkKind"] for c in calls] == ["writing", "sim", "writing"]


def test_a_failed_stamp_never_raises(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("firestore down")

    monkeypatch.setattr(group_work, "set_document", boom)
    touch_work("g", "table")
    touch_seen("g")


def test_no_group_or_unknown_kind_writes_nothing(monkeypatch):
    calls = []
    monkeypatch.setattr(group_work, "set_document", lambda *a, **k: calls.append(a))
    touch_work(None, "table")
    touch_work("g", "keystrokes")
    touch_seen("")
    assert calls == []


@pytest.mark.parametrize(
    ("server", "kind"),
    [
        ("writing", "writing"),
        ("table", "table"),
        ("documents", "document"),
        ("li-ion-batteri", "sim"),
        ("progress", None),
        ("", None),
    ],
)
def test_kind_for_server(server, kind):
    assert kind_for_server(server) == kind
