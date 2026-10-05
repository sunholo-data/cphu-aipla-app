"""1.1.146 M3 — the repair for codes an old Revoke hard-deleted.

In-memory Firestore; the BigQuery / Cloud Logging witnesses are passed in as
rows, which is the seam ``discover`` exists to provide. Nothing here touches a
real project.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from db import classes as classes_db
from db import firestore as fs_module
from db.models.class_ import Class
from scripts import repair_revoked_group_codes as repair

STAMP = datetime(2026, 10, 6, 9, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _local_firestore(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _class(owner: str = "teacher-ar", codes: list[str] | None = None) -> str:
    cls = Class.create_for_teacher(owner_uid=owner, name="Fysik C - Energi")
    classes_db.create_class(cls)
    if codes:
        fs_module.update_document("classes", cls.class_id, {"groupCodes": codes})
    return cls.class_id


def _rosters() -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    classes = classes_db.list_all_classes(include_revoked=True)
    return {c.class_id: set(c.group_codes) for c in classes}, {c.class_id: set(c.revoked_group_codes) for c in classes}


def _discover(**kw):
    rosters, revoked = _rosters()
    return repair.discover(
        bq_pairs=kw.get("bq", []),
        log_revokes=kw.get("log", []),
        unattributed=kw.get("unattributed", []),
        rosters=rosters,
        revoked_rosters=revoked,
        seed_pairs=kw.get("seed", []),
        class_filter=kw.get("class_filter"),
    )


def test_dry_run_writes_nothing():
    cid = _class(codes=["still-live-01"])
    writable, _ = _discover(bq=[{"class_id": cid, "group_id": "busy-garden-11", "sessions": 4, "turns": 235}])

    outcomes = repair.apply(writable, go=False, now=lambda: STAMP)

    assert [(o.code, o.action) for o in outcomes] == [("busy-garden-11", "write")]
    assert fs_module.get_document("anon_groups", "busy-garden-11") is None
    cls = classes_db.get_class(cid)
    assert cls is not None and cls.group_codes == ["still-live-01"]


def test_go_writes_the_tombstone_and_restores_the_roster():
    cid = _class(codes=["still-live-01"])
    writable, _ = _discover(
        log=[{"code": "busy-garden-11", "class_id": cid, "ts": "2026-09-30T09:01:31+00:00"}],
        bq=[{"class_id": cid, "group_id": "busy-garden-11", "sessions": 4, "turns": 235}],
    )

    repair.apply(writable, go=True, now=lambda: STAMP)

    anon = fs_module.get_document("anon_groups", "busy-garden-11")
    assert anon == {
        "revoked": True,
        "classId": cid,
        "revokedAt": "2026-09-30T09:01:31+00:00",
        "repairedAt": STAMP.isoformat(),
        "repairSource": "log",
    }
    cls = classes_db.get_class(cid)
    assert cls is not None
    assert cls.group_codes == ["still-live-01", "busy-garden-11"]
    assert cls.revoked_group_codes == ["busy-garden-11"]
    assert cls.active_group_codes == ["still-live-01"]
    assert cls.revoked_group_codes_at == {"busy-garden-11": "2026-09-30T09:01:31+00:00"}
    # And the class resolves through it again — what the researcher needed.
    assert classes_db.get_class_for_group("busy-garden-11").class_id == cid


def test_second_run_writes_nothing():
    cid = _class()
    log_rows = [{"code": "huge-seed-10", "class_id": cid, "ts": "2026-09-30T09:01:33+00:00"}]
    bq_rows = [{"class_id": cid, "group_id": "huge-seed-10", "sessions": 2, "turns": 40}]
    repair.apply(_discover(log=log_rows, bq=bq_rows)[0], go=True, now=lambda: STAMP)
    before = fs_module.get_document("anon_groups", "huge-seed-10")

    writable, _ = _discover(log=log_rows, bq=bq_rows, seed=[{"code": "huge-seed-10", "class_id": cid}])
    outcomes = repair.apply(writable, go=True, now=lambda: datetime(2027, 1, 1, tzinfo=UTC))

    assert all(o.action != "write" for o in outcomes)
    assert fs_module.get_document("anon_groups", "huge-seed-10") == before


def test_conflicting_class_id_is_refused_never_overwritten():
    mine = _class()
    theirs = _class(owner="teacher-jb", codes=["late-guppy-49"])
    fs_module.set_document("anon_groups", "late-guppy-49", {"classId": theirs})

    # The code is on THEIR roster, so only a log line could name it for mine.
    writable, _ = _discover(log=[{"code": "late-guppy-49", "class_id": mine, "ts": "2026-09-30T09:01:36+00:00"}])
    outcomes = repair.apply(writable, go=True, now=lambda: STAMP)

    assert [(o.code, o.action) for o in outcomes] == [("late-guppy-49", "conflict")]
    assert fs_module.get_document("anon_groups", "late-guppy-49") == {"classId": theirs}
    cls = classes_db.get_class(mine)
    assert cls is not None and "late-guppy-49" not in cls.group_codes


def test_a_live_binding_is_skipped():
    cid = _class()
    fs_module.set_document("anon_groups", "tidy-boulder-05", {"classId": cid, "revoked": False})
    writable, _ = _discover(log=[{"code": "tidy-boulder-05", "class_id": cid, "ts": "2026-09-30T09:01:32+00:00"}])
    outcomes = repair.apply(writable, go=True, now=lambda: STAMP)
    assert [o.action for o in outcomes] == ["live"]
    assert fs_module.get_document("anon_groups", "tidy-boulder-05") == {"classId": cid, "revoked": False}


def test_unattributed_codes_are_listed_not_written():
    """Turns with class_id NULL and the binding gone, but no log witness:
    attributing them to a class needs M's decision."""
    _class()
    writable, list_only = _discover(
        unattributed=[
            {"group_id": "orphan-code-77", "unattributed_turns": 5, "sessions": 1, "binding_missing": True},
            # A legacy unbound code still has its document — not ours.
            {"group_id": "aipla-demo-1", "unattributed_turns": 9, "sessions": 3, "binding_missing": False},
        ]
    )
    assert writable == []
    assert [c.code for c in list_only] == ["orphan-code-77"]
    assert repair.apply(list_only, go=True, now=lambda: STAMP)[0].action == "list-only"
    assert fs_module.get_document("anon_groups", "orphan-code-77") is None


def test_log_witness_attributes_a_code_whose_turns_all_predate_class_id():
    """leafy-thicket-13 on prod: 5 turns, all before 2026-09-11 — only the
    revoke log line knows its class."""
    cid = _class()
    writable, list_only = _discover(
        log=[{"code": "leafy-thicket-13", "class_id": cid, "ts": "2026-09-30T10:45:00+00:00"}],
        unattributed=[
            {"group_id": "leafy-thicket-13", "unattributed_turns": 5, "sessions": 1, "binding_missing": True}
        ],
    )
    assert list_only == []
    assert [(c.code, c.class_id, c.unattributed_turns) for c in writable] == [("leafy-thicket-13", cid, 5)]


def test_class_filter_scopes_the_writes():
    a, b = _class(), _class(owner="teacher-jb")
    writable, _ = _discover(
        bq=[
            {"class_id": a, "group_id": "salty-brook-09", "sessions": 1, "turns": 10},
            {"class_id": b, "group_id": "happy-leaf-26", "sessions": 1, "turns": 20},
        ],
        class_filter=a,
    )
    assert [c.code for c in writable] == ["salty-brook-09"]


def test_m0_check_reports_differences():
    writable = [
        repair.Candidate(code=code, class_id=cls, sources={"log"}) for code, cls in repair.M0_PROD_EXPECTED.items()
    ]
    assert repair.check_against_m0(writable, None) == []
    extra = [*writable, repair.Candidate(code="new-code-01", class_id="x", sources={"bq"})]
    assert repair.check_against_m0(extra, None) == ["discovered but not in M0 evidence: new-code-01 (class x)"]
    seeded_only = [repair.Candidate(code=c.code, class_id=c.class_id, sources={"m0"}) for c in writable]
    assert len(repair.check_against_m0(seeded_only, "59ad12cd997b")) == 1


def test_prod_without_a_class_is_refused():
    assert repair.main(["--env", "prod"]) == 2
