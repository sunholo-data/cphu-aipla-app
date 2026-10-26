"""Compare one element across every group of a class (1.1.99 M1).

- the class owner sees EVERY group of the class, including one with no work
  (an honest empty entry, never a missing card), and nothing of another class;
- a researcher reads any class (the span-tagged bypass);
- a teacher of a different class, an activity the class does not run, and an
  element the activity does not have all get the same 404;
- a read failure is a 503 — never an empty grid that reads as "nothing yet";
- a **student** — a REAL minted group token through the REAL dispatcher, the
  shape of ``test_dual_auth_rejection`` — is refused, whatever class they name;
- the read runs off the event loop.

Staff callers override ``auth.get_current_user`` (the dispatcher symbol the
route imports); the student half uses no override at all.
"""

from __future__ import annotations

import threading
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, get_current_user
from auth.access_context import build_access_context
from auth.group_id_auth import AnonymousGroupAuth, create_group, join_group
from db import firestore as fs_module
from db.models.activity import Activity
from protocols import class_compare_routes
from protocols.class_compare_routes import router as compare_router

ACTIVITY = "act-fald"
OTHER_ACTIVITY = "act-other"
G1, G2, G3, G_OTHER = "fald-grp-11", "fald-grp-22", "fald-grp-33", "other-grp-99"

CLASSES = {
    "cls-1": SimpleNamespace(
        class_id="cls-1",
        owner_uid="teacher-1",
        group_codes=[G1, G2, G3],
        revoked_group_codes=[G3],
        activity_ids=[ACTIVITY],
    ),
    "cls-2": SimpleNamespace(
        class_id="cls-2", owner_uid="teacher-2", group_codes=[G_OTHER], revoked_group_codes=[], activity_ids=[ACTIVITY]
    ),
}

ACT = Activity.model_validate(
    {
        "activityId": ACTIVITY,
        "ownerUid": "author-1",
        "title": "Frit fald",
        "table": [
            {
                "id": "t1",
                "title": "Målinger",
                "columns": [{"id": "h", "label": "h", "unit": "m"}, {"id": "t", "label": "t", "unit": "s"}],
                "rows": 5,
            },
            {"id": "t2", "title": "Andet", "columns": [{"id": "x", "label": "x"}], "rows": 2},
        ],
        "chart": [{"id": "c1", "title": "h mod t", "chartKind": "scatter"}],
        "writing": [{"id": "w1", "title": "Konklusion", "prompt": "Hvad viser grafen?"}],
        "checklist": [{"id": "step-1", "label": "Mål"}, {"id": "step-2", "label": "Plot"}],
    }
)

RESEARCHER = User(uid="r-1", email="r@ku.dk", is_teacher=True, is_researcher=True)
TEACHER_1 = User(uid="teacher-1", email="t1@ku.dk", is_teacher=True)
TEACHER_2 = User(uid="teacher-2", email="t2@ku.dk", is_teacher=True)


@pytest.fixture(autouse=True)
def _world(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()
    # G1 has work on everything; G2 has a table row in t2 only (nothing in t1);
    # G3 (revoked) has a table; G_OTHER is another class's.
    fs_module.set_document(
        "table_progress",
        f"{G1}:{ACTIVITY}",
        {
            "groupId": G1,
            "activityId": ACTIVITY,
            "cells": {"t1::0::h": "1.2", "t1::0::t": "0.49", "t2::0::x": "9"},
            "updatedAt": "2026-10-26T09:00:00+00:00",
        },
    )
    fs_module.set_document(
        "table_progress",
        f"{G2}:{ACTIVITY}",
        {"groupId": G2, "activityId": ACTIVITY, "cells": {"t2::0::x": "4"}, "updatedAt": "2026-10-26T09:01:00+00:00"},
    )
    fs_module.set_document(
        "table_progress",
        f"{G3}:{ACTIVITY}",
        {"groupId": G3, "activityId": ACTIVITY, "cells": {"t1::0::h": "2"}, "updatedAt": "2026-10-26T09:02:00+00:00"},
    )
    fs_module.set_document(
        "table_progress",
        f"{G_OTHER}:{ACTIVITY}",
        {"groupId": G_OTHER, "activityId": ACTIVITY, "cells": {"t1::0::h": "7"}, "updatedAt": "x"},
    )
    fs_module.set_document(
        "writing_progress",
        f"{G1}:{ACTIVITY}",
        {
            "groupId": G1,
            "activityId": ACTIVITY,
            "docs": {"w1": {"text": "Vi målte faldet.", "updatedAt": "2026-10-26T09:05:00+00:00"}},
            "updatedAt": "2026-10-26T09:05:00+00:00",
        },
    )
    fs_module.set_document(
        "checklist_progress",
        f"{G2}:{ACTIVITY}",
        {"groupId": G2, "activityId": ACTIVITY, "itemStates": {"step-1": {"done": True}}, "updatedAt": "u"},
    )
    monkeypatch.setattr(class_compare_routes, "get_activity", lambda aid: ACT if aid == ACTIVITY else None)
    monkeypatch.setattr(class_compare_routes, "get_class", lambda cid: CLASSES.get(cid))
    monkeypatch.setattr("analytics.auth.get_class", lambda cid: CLASSES.get(cid))
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(compare_router)
    return app


def _staff(user: User) -> TestClient:
    app = _app()

    async def _override(request: Request) -> User:
        request.state.access = build_access_context(user)
        return user

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def _compare(client: TestClient, cls: str = "cls-1", **params):
    q = {"activityId": ACTIVITY, "kind": "table", "elementId": "t1", **params}
    return client.get(f"/api/classes/{cls}/compare", params=q)


def _by_code(body: dict) -> dict:
    return {g["groupCode"]: g for g in body["groups"]}


def test_the_class_owner_sees_every_group_of_their_class_and_only_theirs():
    resp = _compare(_staff(TEACHER_1))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    groups = _by_code(body)
    assert list(groups) == [G1, G2, G3]  # class order; never the other class's
    # The table slice is THIS table's cells only — t2's do not leak into t1's card.
    assert groups[G1]["data"] == {"t1::0::h": "1.2", "t1::0::t": "0.49"}
    assert groups[G1]["updatedAt"] == "2026-10-26T09:00:00+00:00"
    # G2 touched a different table only → an honest empty entry, not a missing one.
    assert groups[G2]["data"] is None and groups[G2]["updatedAt"] is None
    # A revoked code's work is still evidence (1.1.146), and says it is revoked.
    assert groups[G3]["revoked"] is True and groups[G3]["data"] == {"t1::0::h": "2"}
    assert body["elements"]["table"][0]["id"] == "t1"


def test_a_chart_carries_every_table_and_its_cells():
    body = _compare(_staff(TEACHER_1), kind="chart", elementId="c1").json()
    assert {t["id"] for t in body["elements"]["table"]} == {"t1", "t2"}
    assert body["elements"]["chart"][0]["id"] == "c1"
    assert "t2::0::x" in _by_code(body)[G1]["data"]


def test_writing_and_checklist_read_their_own_stores():
    writing = _by_code(_compare(_staff(TEACHER_1), kind="writing", elementId="w1").json())
    assert writing[G1]["data"]["text"] == "Vi målte faldet."
    assert writing[G2]["data"] is None
    checklist = _by_code(_compare(_staff(TEACHER_1), kind="checklist", elementId="checklist").json())
    assert checklist[G2]["data"] == {"step-1": {"done": True}}
    assert checklist[G1]["data"] is None


def test_a_researcher_reads_any_class():
    resp = _compare(_staff(RESEARCHER), cls="cls-2")
    assert resp.status_code == 200
    assert list(_by_code(resp.json())) == [G_OTHER]


def test_everything_outside_the_callers_reach_is_the_same_404():
    other_teacher = _compare(_staff(TEACHER_2), cls="cls-1")
    missing_class = _compare(_staff(RESEARCHER), cls="cls-nope")
    not_in_class = _compare(_staff(TEACHER_1), activityId=OTHER_ACTIVITY)
    no_element = _compare(_staff(TEACHER_1), elementId="t-nope")
    wrong_kind = _compare(_staff(TEACHER_1), kind="writing", elementId="t1")
    statuses = {r.status_code for r in (other_teacher, missing_class, not_in_class, no_element, wrong_kind)}
    assert statuses == {404}
    assert other_teacher.json() == missing_class.json()


def test_a_read_failure_is_a_503_not_an_empty_grid(monkeypatch):
    def _boom(**_kw):
        raise RuntimeError("firestore unavailable")

    monkeypatch.setattr(class_compare_routes, "query_documents", _boom)
    resp = _compare(_staff(TEACHER_1))
    assert resp.status_code == 503


def test_the_picker_lists_comparable_elements():
    resp = _staff(TEACHER_1).get("/api/classes/cls-1/compare/elements")
    assert resp.status_code == 200
    (activity,) = resp.json()["activities"]
    assert activity["activityId"] == ACTIVITY
    assert [(e["kind"], e["id"]) for e in activity["elements"]] == [
        ("table", "t1"),
        ("table", "t2"),
        ("chart", "c1"),
        ("writing", "w1"),
        ("checklist", "checklist"),
    ]
    assert _staff(TEACHER_2).get("/api/classes/cls-1/compare/elements").status_code == 404


def test_the_read_runs_off_the_event_loop(monkeypatch):
    seen: list[str] = []
    real = class_compare_routes.compare_element

    def _spy(*a, **kw):
        seen.append(threading.current_thread().name)
        return real(*a, **kw)

    monkeypatch.setattr(class_compare_routes, "compare_element", _spy)
    assert _compare(_staff(TEACHER_1)).status_code == 200
    assert seen and seen[0] != threading.main_thread().name


# ---------------------------------------------------------------------------
# A REAL student token through the REAL dispatcher — no override.
# ---------------------------------------------------------------------------


def _real_student_token() -> str:
    record = create_group(title="cmp class", skill_ids=["concept-dialogue"], creator_uid="teacher-1")
    return join_group(record.group_id, client_ip="203.0.113.7").token


@pytest.mark.parametrize("cls", ["cls-1", "cls-2"])
def test_a_real_student_token_is_refused(cls):
    client = TestClient(_app())
    headers = {"Authorization": f"Bearer {_real_student_token()}"}
    compare = client.get(
        f"/api/classes/{cls}/compare",
        params={"activityId": ACTIVITY, "kind": "table", "elementId": "t1"},
        headers=headers,
    )
    picker = client.get(f"/api/classes/{cls}/compare/elements", headers=headers)
    assert compare.status_code == 403, compare.text
    assert picker.status_code == 403, picker.text
    assert "groups" not in compare.text


def test_no_token_is_refused():
    resp = TestClient(_app()).get(
        "/api/classes/cls-1/compare", params={"activityId": ACTIVITY, "kind": "table", "elementId": "t1"}
    )
    assert resp.status_code in (401, 403)
