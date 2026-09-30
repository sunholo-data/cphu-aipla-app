"""1.1.140 M2 — syncing tutor→framework assignments between environments."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "sync_tutor_assignments",
    Path(__file__).resolve().parents[2] / "scripts" / "sync_tutor_assignments.py",
)
sync = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = sync  # dataclasses resolve their module by name
_SPEC.loader.exec_module(sync)  # type: ignore[union-attr]


# ── a tiny fake Firestore: collection().stream() / document().set|delete ──────


class _Snap:
    def __init__(self, doc_id: str, data: dict[str, Any]):
        self.id = doc_id
        self._data = data

    def to_dict(self) -> dict[str, Any]:
        return dict(self._data)


class _Doc:
    def __init__(self, store: FakeClient, doc_id: str):
        self._store, self._id = store, doc_id

    def set(self, data: dict[str, Any], merge: bool = False) -> None:
        self._store.writes.append(("set", self._id, dict(data)))
        self._store.rows[self._id] = dict(data)

    def delete(self) -> None:
        self._store.writes.append(("delete", self._id, None))
        self._store.rows.pop(self._id, None)


class _Col:
    def __init__(self, store: FakeClient):
        self._store = store

    def stream(self):
        if self._store.fail:
            raise PermissionError("403 Missing or insufficient permissions")
        return [_Snap(k, v) for k, v in self._store.rows.items()]

    def document(self, doc_id: str) -> _Doc:
        return _Doc(self._store, doc_id)


class FakeClient:
    def __init__(self, rows: dict[str, dict[str, Any]] | None = None, *, fail: bool = False):
        self.rows = dict(rows or {})
        self.writes: list[tuple] = []
        self.fail = fail
        self.collections: list[str] = []

    def collection(self, name: str) -> _Col:
        self.collections.append(name)
        return _Col(self)


def _row(fw: str | None, by: str = "researcher-uid") -> dict[str, Any]:
    return {"frameworkId": fw, "updatedBy": by, "updatedAt": "2026-09-20T10:00:00+00:00"}


PROD = {
    "sofie": _row("esru"),
    "henrik": _row("socratic"),
    "led-planck-tutor": _row(None),  # explicit "no framework"
}


# ── plan ──────────────────────────────────────────────────────────────────────


def test_plan_adds_every_source_row_to_an_empty_target():
    ops = sync.plan_sync(PROD, {})
    assert [(o.action, o.tutor_id) for o in ops] == [
        ("add", "henrik"),
        ("add", "led-planck-tutor"),
        ("add", "sofie"),
    ]


def test_none_framework_row_is_planned_as_a_row_not_dropped():
    ops = sync.plan_sync({"t": _row(None)}, {})
    assert len(ops) == 1 and ops[0].action == "add" and ops[0].source_framework is None


def test_matching_framework_is_a_noop_even_when_provenance_differs():
    target = {"sofie": {"frameworkId": "esru", "updatedBy": "sync:prod"}}
    assert sync.plan_sync({"sofie": _row("esru")}, target) == []


def test_changed_framework_is_a_change_including_to_and_from_none():
    target = {"sofie": _row("socratic"), "led-planck-tutor": _row("esru")}
    ops = sync.plan_sync({"sofie": _row("esru"), "led-planck-tutor": _row(None)}, target)
    assert {(o.action, o.tutor_id, o.source_framework, o.target_framework) for o in ops} == {
        ("change", "sofie", "esru", "socratic"),
        ("change", "led-planck-tutor", None, "esru"),
    }


def test_target_only_rows_are_kept_unless_prune():
    target = {"stray": _row("esru")}
    assert sync.plan_sync({}, target) == []
    ops = sync.plan_sync({}, target, prune=True)
    assert [(o.action, o.tutor_id) for o in ops] == [("remove", "stray")]


# ── main: dry-run, GO, refusals ───────────────────────────────────────────────


def _factory(clients: dict[str, FakeClient]):
    return lambda env: clients[env]


def test_dry_run_makes_no_writes(capsys):
    clients = {"prod": FakeClient(PROD), "test": FakeClient()}
    assert sync.main(["--from", "prod", "--to", "test"], client_factory=_factory(clients)) == 0
    assert clients["test"].writes == [] and clients["prod"].writes == []
    out = capsys.readouterr().out
    assert "dry run" in out and "+ add" in out and "led-planck-tutor" in out


def test_go_writes_exactly_the_plan_with_sync_provenance():
    target = FakeClient({"sofie": _row("esru"), "henrik": _row("esru"), "stray": _row("x")})
    clients = {"prod": FakeClient(PROD), "test": target}
    assert sync.main(["--from", "prod", "--to", "test", "--go"], client_factory=_factory(clients)) == 0

    # sofie matched (no write), henrik changed, led-planck added; stray kept.
    assert [(w[0], w[1]) for w in target.writes] == [("set", "henrik"), ("set", "led-planck-tutor")]
    assert clients["prod"].writes == []
    henrik = target.rows["henrik"]
    assert henrik["frameworkId"] == "socratic"
    assert henrik["updatedBy"] == "sync:prod"
    assert henrik["syncedFrom"] == "prod"
    assert henrik["syncedFromUpdatedBy"] == "researcher-uid"
    assert henrik["updatedAt"] != "2026-09-20T10:00:00+00:00"
    led = target.rows["led-planck-tutor"]
    assert "frameworkId" in led and led["frameworkId"] is None
    assert "stray" in target.rows
    assert all(c == sync.COLLECTION for c in target.collections)


def test_go_with_prune_removes_target_only_rows():
    target = FakeClient({"stray": _row("x")})
    clients = {"prod": FakeClient({}), "dev": target}
    assert sync.main(["--from", "prod", "--to", "dev", "--go", "--prune"], client_factory=_factory(clients)) == 0
    assert target.writes == [("delete", "stray", None)]


def test_to_prod_is_refused_without_force():
    called: list[str] = []

    def factory(env: str) -> FakeClient:
        called.append(env)
        return FakeClient()

    assert sync.main(["--from", "test", "--to", "prod", "--go"], client_factory=factory) == 2
    assert called == []  # refused before any client is even built


def test_to_prod_with_force_is_allowed():
    clients = {"test": FakeClient({"a": _row("esru")}), "prod": FakeClient()}
    rc = sync.main(["--from", "test", "--to", "prod", "--go", "--force"], client_factory=_factory(clients))
    assert rc == 0 and [w[1] for w in clients["prod"].writes] == ["a"]


def test_same_env_is_refused():
    assert sync.main(["--from", "test", "--to", "test"], client_factory=_factory({})) == 2


@pytest.mark.parametrize("side", ["prod", "test"])
def test_read_failure_is_not_zero_rows(side, capsys):
    clients = {"prod": FakeClient(PROD), "test": FakeClient()}
    clients[side].fail = True
    rc = sync.main(["--from", "prod", "--to", "test", "--go"], client_factory=_factory(clients))
    assert rc == 1
    assert clients["test"].writes == []
    assert "CANNOT READ" in capsys.readouterr().err


def test_each_env_gets_its_own_explicit_project(monkeypatch):
    seen: list[str] = []

    class _FS:
        @staticmethod
        def Client(project: str):
            seen.append(project)
            return object()

    import google.cloud

    monkeypatch.setattr(google.cloud, "firestore", _FS, raising=False)
    monkeypatch.setitem(sys.modules, "google.cloud.firestore", _FS)
    sync.make_client("prod")
    sync.make_client("test")
    assert seen == ["aipla-prod-2026", "aipla-test-2026"]
