"""1.1.150 M2 — backfilling ``createdBy`` / ``createdVia`` / ``createdAt``.

The script fills only what is CERTAIN and never overwrites: a dry run writes
nothing, ``--go`` writes missing fields only, and a recorded ``createdVia`` is
never touched. A human row's channel is never guessed.
"""

from __future__ import annotations

import importlib.util
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_SPEC = importlib.util.spec_from_file_location(
    "backfill_authored_provenance",
    Path(__file__).resolve().parents[2] / "scripts" / "backfill_authored_provenance.py",
)
backfill = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = backfill
_SPEC.loader.exec_module(backfill)  # type: ignore[union-attr]

CREATED = datetime(2026, 10, 3, 13, 0, 42, tzinfo=UTC)


class _Snap:
    def __init__(self, doc_id: str, data: dict[str, Any]):
        self.id = doc_id
        self._data = data
        self.create_time = CREATED

    def to_dict(self) -> dict[str, Any]:
        return dict(self._data)


class _Doc:
    def __init__(self, client: _Client, coll: str, doc_id: str):
        self._client, self._coll, self._id = client, coll, doc_id

    def set(self, data: dict[str, Any], merge: bool = False) -> None:
        assert merge, "the backfill must merge, never replace a row"
        self._client.writes.append((self._coll, self._id, dict(data)))
        self._client.rows[self._coll][self._id].update(data)


class _Coll:
    def __init__(self, client: _Client, name: str):
        self._client, self._name = client, name

    def stream(self):
        return [_Snap(i, d) for i, d in self._client.rows.get(self._name, {}).items()]

    def document(self, doc_id: str) -> _Doc:
        return _Doc(self._client, self._name, doc_id)


class _Client:
    def __init__(self, rows: dict[str, dict[str, dict[str, Any]]]):
        self.rows = rows
        self.writes: list[tuple[str, str, dict[str, Any]]] = []

    def collection(self, name: str) -> _Coll:
        return _Coll(self, name)


def _fixture() -> _Client:
    return _Client(
        {
            "tutors": {
                "concept-dialogue": {"authorUid": "platform-seed", "createdAt": "2026-09-10T00:00:00+00:00"},
                "t1-tutor": {"authorUid": "t-1", "createdAt": "2026-09-30T00:00:00+00:00"},
            },
            "authored_frameworks": {
                # The seminar's row, as M0 read it on prod.
                "custom-didaktisk-tutor": {"authorUid": "t-1", "authorRole": "teacher", "version": 1},
                # Already stamped by a 1.1.150 save: must not change.
                "custom-new": {
                    "authorUid": "t-2",
                    "createdBy": "t-2",
                    "createdVia": "copilot",
                    "createdAt": "2026-10-06T00:00:00+00:00",
                },
            },
            "custom_personas": {"persona-fru-hansen": {"authorUid": "t-1"}},
        }
    )


def test_dry_run_writes_nothing():
    client = _fixture()
    assert backfill.main(["--env", "dev"], client_factory=lambda env: client) == 0
    assert client.writes == []


def test_go_fills_only_what_is_certain():
    client = _fixture()
    backfill.main(["--env", "dev", "--go"], client_factory=lambda env: client)

    seed = client.rows["tutors"]["concept-dialogue"]
    assert (seed["createdBy"], seed["createdVia"]) == ("platform-seed", "seed")
    assert seed["createdAt"] == "2026-09-10T00:00:00+00:00", "an existing createdAt is kept"

    human = client.rows["authored_frameworks"]["custom-didaktisk-tutor"]
    assert human["createdBy"] == "t-1"
    assert human["createdAt"] == CREATED.isoformat()
    assert "createdVia" not in human, "a human row's channel is not recorded, so it is not guessed"

    persona = client.rows["custom_personas"]["persona-fru-hansen"]
    assert persona["createdBy"] == "t-1" and persona["createdAt"] == CREATED.isoformat()


def test_go_never_overwrites_a_recorded_value():
    client = _fixture()
    backfill.main(["--env", "dev", "--go"], client_factory=lambda env: client)
    assert all(doc_id != "custom-new" for _, doc_id, _ in client.writes)
    assert client.rows["authored_frameworks"]["custom-new"]["createdVia"] == "copilot"

    # A seed-authored row whose channel was somehow recorded differently keeps it.
    assert backfill.plan_row({"authorUid": "platform-seed", "createdVia": "sync"}, CREATED) == {
        "createdBy": "platform-seed",
        "createdAt": CREATED.isoformat(),
    }


def test_seed_author_matches_the_one_the_seed_writes():
    from db.models.authorship import SEED_AUTHOR

    assert backfill.SEED_AUTHOR == SEED_AUTHOR


def test_rerunning_is_a_no_op():
    client = _fixture()
    backfill.main(["--env", "dev", "--go"], client_factory=lambda env: client)
    first = len(client.writes)
    backfill.main(["--env", "dev", "--go"], client_factory=lambda env: client)
    assert len(client.writes) == first
