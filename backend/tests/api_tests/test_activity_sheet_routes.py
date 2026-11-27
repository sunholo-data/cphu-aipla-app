"""1.1.165 — GET /api/classes/{id}/activities/{activity_id}/sheet.

Owner or researcher; the activity must be in the class; one sheet per LIVE code;
Markdown never needs AILANG Parse, Word does and is a 503 when it fails.
"""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from db.activities import save_activity
from db.classes import create_class, mint_group_codes_under_class, revoke_group_code
from db.models.activity import Activity
from db.models.class_ import Class
from handouts import activity_sheet

OWNER = "teacher-alice"
ACT = "act-sheet"


@pytest.fixture(autouse=True)
def _local_firestore(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    from auth.group_id_auth import AnonymousGroupAuth

    AnonymousGroupAuth.reset_for_tests()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


def _setup(*, assign: bool = True, codes: int = 2, activity_owner: str = "someone-else") -> tuple[str, list[str]]:
    # Owned by ANOTHER teacher on purpose: a shared-library activity assigned to
    # this class must print like the teacher's own.
    save_activity(
        Activity(
            activityId=ACT,
            ownerUid=activity_owner,
            title="Boldkast",
            language="da",
            teachingGoal="PRIVATE GOAL",
            checklist=[{"id": "a", "label": "Åbn simulationen"}],
        )
    )
    cls = Class.create_for_teacher(owner_uid=OWNER, name="Fysik B")
    if assign:
        cls.activity_ids = [ACT]
    create_class(cls)
    return cls.class_id, mint_group_codes_under_class(cls.class_id, count=codes)


def _client(uid: str = OWNER, *, is_researcher: bool = False) -> TestClient:
    from protocols.activity_sheet_routes import router

    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(uid=uid, email=f"{uid}@example.test", is_teacher=True, is_researcher=is_researcher)
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def _url(class_id: str, **q) -> str:
    query = "&".join(f"{k}={v}" for k, v in q.items())
    return f"/api/classes/{class_id}/activities/{ACT}/sheet" + (f"?{query}" if query else "")


def test_owner_gets_one_sheet_per_live_code():
    class_id, codes = _setup()
    resp = _client().get(_url(class_id, origin="https://aipla.ku.dk"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["title"] == "Boldkast" and body["language"] == "da"
    assert [s["code"] for s in body["sheets"]] == codes
    for s, code in zip(body["sheets"], codes, strict=True):
        assert f"https://aipla.ku.dk/group?code={code}" in s["markdown"]
    assert "PRIVATE" not in resp.text


def test_revoked_codes_get_no_sheet():
    class_id, codes = _setup()
    revoke_group_code(class_id, codes[0])
    body = _client().get(_url(class_id)).json()
    assert [s["code"] for s in body["sheets"]] == [codes[1]]


def test_code_narrows_to_one_group_and_must_be_live_in_this_class():
    class_id, codes = _setup()
    body = _client().get(_url(class_id, code=codes[1])).json()
    assert [s["code"] for s in body["sheets"]] == [codes[1]]
    assert _client().get(_url(class_id, code="not-a-code")).status_code == 404


def test_class_without_codes_gets_one_blank_sheet():
    class_id, _ = _setup(codes=0)
    body = _client().get(_url(class_id)).json()
    assert len(body["sheets"]) == 1 and body["sheets"][0]["code"] is None


def test_other_teacher_gets_404():
    class_id, _ = _setup()
    assert _client("teacher-bob").get(_url(class_id)).status_code == 404


def test_researcher_may_print():
    class_id, _ = _setup()
    assert _client("researcher-r", is_researcher=True).get(_url(class_id)).status_code == 200


def test_activity_not_in_the_class_is_409():
    class_id, _ = _setup(assign=False)
    assert _client().get(_url(class_id)).status_code == 409


def test_markdown_never_calls_parse():
    class_id, _ = _setup()
    with patch.object(activity_sheet, "_convert") as convert:
        assert _client().get(_url(class_id)).status_code == 200
    convert.assert_not_called()


def _fake_docx(markdown: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", "<w:t>" + " ".join(re.findall(r"AIPLAGROUP\d+X", markdown)) + "</w:t>")
    return buf.getvalue()


def test_word_download_has_every_code_and_a_filename():
    class_id, codes = _setup()
    with patch.object(activity_sheet, "_convert", side_effect=_fake_docx):
        resp = _client().get(_url(class_id, format="docx"))
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert 'filename="aktivitetsark-boldkast.docx"' in resp.headers["content-disposition"]
    doc = zipfile.ZipFile(io.BytesIO(resp.content)).read("word/document.xml").decode()
    assert all(code in doc for code in codes)


def test_word_failure_is_503_and_markdown_still_works():
    class_id, _ = _setup()
    with patch.object(activity_sheet, "_convert", side_effect=activity_sheet.SheetUnavailable("down")):
        resp = _client().get(_url(class_id, format="docx"))
        assert resp.status_code == 503
        assert _client().get(_url(class_id)).status_code == 200


def test_sheet_router_is_registered_before_the_activity_config_catch_all():
    """``GET /api/activity-configs/{teacher_uid}/{class_id}/{activity_id}`` would
    match ``/active/{id}/sheet``; FastAPI takes the first registered route."""
    src = (Path(__file__).resolve().parents[2] / "fast_api_app.py").read_text()
    assert src.index("app.include_router(activity_sheet_router)") < src.index(
        "app.include_router(activity_config_router)"
    )
