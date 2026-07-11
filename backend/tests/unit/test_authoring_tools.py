"""Unit tests for the activity-authoring co-pilot's set_lesson_prompt write-tool
(COPILOT-1 M1).

Headline: OWNER-SCOPING. The tool proposes a teachingGoal only for the caller's
OWN activity, returns an enumeration-resistant denial otherwise, and NEVER
persists — the teacher's Apply (PATCH /api/activities) is the only write.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from db import firestore as fs_module
from db.activities import create_activity
from db.models.activity import Activity

TEACHER = "teacher-1"
OTHER = "teacher-other"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _tc(uid: str | None):
    """A stub ToolContext: identity rides _invocation_context.user_id (the
    production path) per the analytics.tools._caller_uid precedent."""
    return SimpleNamespace(_invocation_context=SimpleNamespace(user_id=uid), state={})


def _make_activity(owner: str = TEACHER) -> str:
    a = create_activity(Activity(activityId="", skillId="concept", ownerUid=owner, title="A"))
    return a.activity_id


def test_owner_gets_a_well_formed_proposal():
    from adk.authoring_tools import set_lesson_prompt

    aid = _make_activity(TEACHER)
    res = set_lesson_prompt(text="Udforsk energibevarelse for en B-klasse.", activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is True
    assert res["proposal"]["field"] == "teachingGoal"
    assert res["proposal"]["activityId"] == aid
    assert "energibevarelse" in res["proposal"]["value"].lower()


def test_non_owner_is_denied():
    from adk.authoring_tools import set_lesson_prompt

    aid = _make_activity(TEACHER)
    res = set_lesson_prompt(text="hax", activity_id=aid, tool_context=_tc(OTHER))
    assert res["ok"] is False


def test_missing_activity_same_shape_as_denied():
    # Enumeration-resistant: a missing activity and a not-owned one return the
    # same negative shape (no existence leak).
    from adk.authoring_tools import set_lesson_prompt

    denied = set_lesson_prompt(text="x", activity_id=_make_activity(OTHER), tool_context=_tc(TEACHER))
    missing = set_lesson_prompt(text="x", activity_id="act-does-not-exist", tool_context=_tc(TEACHER))
    assert denied["ok"] is False and missing["ok"] is False
    assert denied.get("error") == missing.get("error")


def test_no_identity_is_denied_not_crashed():
    from adk.authoring_tools import set_lesson_prompt

    res = set_lesson_prompt(text="x", activity_id="act-1", tool_context=_tc(None))
    assert res["ok"] is False


def test_empty_or_overlong_text_is_rejected():
    from adk.authoring_tools import MAX_GOAL_LEN, set_lesson_prompt

    aid = _make_activity(TEACHER)
    assert set_lesson_prompt(text="   ", activity_id=aid, tool_context=_tc(TEACHER))["ok"] is False
    assert set_lesson_prompt(text="x" * (MAX_GOAL_LEN + 1), activity_id=aid, tool_context=_tc(TEACHER))["ok"] is False


def test_tool_never_persists(monkeypatch):
    # The tool proposes; only the teacher's Apply persists. Guard the tool path
    # never writes to the store.
    from adk import authoring_tools

    aid = _make_activity(TEACHER)

    def _boom(*_a, **_k):
        raise AssertionError("set_lesson_prompt must not persist — it only proposes")

    monkeypatch.setattr(authoring_tools, "save_activity", _boom)
    res = authoring_tools.set_lesson_prompt(text="A good goal.", activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is True
    # the stored activity is untouched (still the empty default goal)
    from db.activities import get_activity

    assert get_activity(aid).teaching_goal == ""


# --- COPILOT-2 M1: add_element (owner-scoped, propose-only, registry-validated) ---


def test_add_element_owner_gets_a_checklist_proposal():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    res = add_element(
        element_kind="checklist",
        items=["Find massen", " Beregn energien ", "", "Sammenlign"],
        activity_id=aid,
        tool_context=_tc(TEACHER),
    )
    assert res["ok"] is True
    assert res["proposal"]["kind"] == "add_element"
    assert res["proposal"]["element_kind"] == "checklist"
    # blanks stripped, whitespace trimmed
    assert res["proposal"]["spec"]["items"] == ["Find massen", "Beregn energien", "Sammenlign"]


def test_add_element_non_owner_is_denied():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    res = add_element(element_kind="checklist", items=["x"], activity_id=aid, tool_context=_tc(OTHER))
    assert res["ok"] is False


def test_add_element_rejects_unknown_and_unsupported_kinds():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    unknown = add_element(element_kind="bogus", items=["x"], activity_id=aid, tool_context=_tc(TEACHER))
    unsupported = add_element(element_kind="calculator", items=["x"], activity_id=aid, tool_context=_tc(TEACHER))
    assert unknown["ok"] is False and unsupported["ok"] is False


def test_add_element_rejects_empty_checklist():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    assert (
        add_element(element_kind="checklist", items=["  ", ""], activity_id=aid, tool_context=_tc(TEACHER))["ok"]
        is False
    )


def test_add_element_caps_item_count():
    from adk.authoring_tools import MAX_CHECKLIST_ITEMS, add_element

    aid = _make_activity(TEACHER)
    res = add_element(
        element_kind="checklist",
        items=[f"trin {i}" for i in range(MAX_CHECKLIST_ITEMS + 10)],
        activity_id=aid,
        tool_context=_tc(TEACHER),
    )
    assert len(res["proposal"]["spec"]["items"]) == MAX_CHECKLIST_ITEMS


def test_add_element_never_persists(monkeypatch):
    from adk import authoring_tools

    aid = _make_activity(TEACHER)
    monkeypatch.setattr(
        authoring_tools, "save_activity", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not persist"))
    )
    res = authoring_tools.add_element(element_kind="checklist", items=["a"], activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is True


# --- COPILOT-2 M2: set_artefact (owner-scoped, propose-only, catalogue-validated) ---


def test_set_artefact_owner_gets_a_sim_proposal():
    from adk.authoring_tools import set_artefact

    aid = _make_activity(TEACHER)
    res = set_artefact(artefact_id="boldkast", activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is True
    assert res["proposal"]["kind"] == "set_artefact"
    assert res["proposal"]["artefactId"] == "boldkast"
    assert "boldkast" in res["proposal"]["label"].lower()


def test_set_artefact_non_owner_is_denied():
    from adk.authoring_tools import set_artefact

    aid = _make_activity(TEACHER)
    res = set_artefact(artefact_id="boldkast", activity_id=aid, tool_context=_tc(OTHER))
    assert res["ok"] is False


def test_set_artefact_unknown_sim_returns_the_catalogue():
    # Self-correcting: an invalid id returns the available sims so the agent retries.
    from adk.authoring_tools import set_artefact

    aid = _make_activity(TEACHER)
    res = set_artefact(artefact_id="not-a-sim", activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is False
    ids = {s["id"] for s in res["available"]}
    assert {"boldkast", "kinebot", "led-planck"} <= ids


def test_set_artefact_never_persists(monkeypatch):
    from adk import authoring_tools

    aid = _make_activity(TEACHER)
    monkeypatch.setattr(
        authoring_tools, "save_activity", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not persist"))
    )
    res = authoring_tools.set_artefact(artefact_id="boldkast", activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is True


# --- COPILOT-2 M3: add_element note / solution / document (text-authored kinds) ---


def test_add_element_note_owner_gets_a_proposal():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    res = add_element(
        element_kind="note",
        text="Husk: energi måles i joule.",
        title="Energi",
        activity_id=aid,
        tool_context=_tc(TEACHER),
    )
    assert res["ok"] is True
    assert res["proposal"]["element_kind"] == "note"
    assert res["proposal"]["spec"] == {"title": "Energi", "body": "Husk: energi måles i joule."}


def test_add_element_solution_and_document_carry_a_prompt():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    for kind in ("solution", "document"):
        res = add_element(element_kind=kind, text="Vis din løsning.", activity_id=aid, tool_context=_tc(TEACHER))
        assert res["ok"] is True, kind
        assert res["proposal"]["element_kind"] == kind
        assert res["proposal"]["spec"] == {"prompt": "Vis din løsning."}


def test_add_element_text_kinds_require_text():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    for kind in ("note", "solution", "document"):
        assert add_element(element_kind=kind, text="  ", activity_id=aid, tool_context=_tc(TEACHER))["ok"] is False, (
            kind
        )


def test_add_element_text_kinds_owner_scoped():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    assert add_element(element_kind="note", text="x", activity_id=aid, tool_context=_tc(OTHER))["ok"] is False


# --- COPILOT-2 M4: structured elements — table / chart / calculator ---


def test_add_element_table_builds_a_validated_spec():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    res = add_element(
        element_kind="table",
        title="Målinger",
        columns=[{"label": "tid", "unit": "s", "kind": "number"}, {"label": "navn", "kind": "text"}],
        rows=6,
        activity_id=aid,
        tool_context=_tc(TEACHER),
    )
    assert res["ok"] is True
    assert res["proposal"]["element_kind"] == "table"
    assert res["proposal"]["spec"]["rows"] == 6
    assert [c["label"] for c in res["proposal"]["spec"]["columns"]] == ["tid", "navn"]


def test_add_element_table_rejects_no_columns():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    assert add_element(element_kind="table", columns=[], activity_id=aid, tool_context=_tc(TEACHER))["ok"] is False


def test_add_element_chart_carries_kind():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    res = add_element(element_kind="chart", chart_kind="line", title="v-t", activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is True
    assert res["proposal"]["spec"]["chartKind"] == "line"


def test_add_element_chart_rejects_unknown_kind():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    assert (
        add_element(element_kind="chart", chart_kind="pie", activity_id=aid, tool_context=_tc(TEACHER))["ok"] is False
    )


def test_add_element_calculator_validates_formula_coherence():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    ok = add_element(
        element_kind="calculator",
        formula="s / t",
        inputs=[{"id": "s", "label": "strækning", "unit": "m"}, {"id": "t", "label": "tid", "unit": "s"}],
        activity_id=aid,
        tool_context=_tc(TEACHER),
    )
    assert ok["ok"] is True
    assert ok["proposal"]["spec"]["formula"] == "s / t"
    # a formula referencing an undefined variable is rejected (coherence)
    bad = add_element(
        element_kind="calculator",
        formula="s / q",
        inputs=[{"id": "s", "label": "strækning"}],
        activity_id=aid,
        tool_context=_tc(TEACHER),
    )
    assert bad["ok"] is False


def test_add_element_structured_kinds_owner_scoped():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    assert add_element(element_kind="chart", chart_kind="bar", activity_id=aid, tool_context=_tc(OTHER))["ok"] is False


# --- Draft mode: authoring a brand-new activity (/new) has no activity_id yet ---


def test_draft_mode_no_activity_id_proposes_without_owner_check():
    # On /new the activity isn't persisted yet, so the tools propose without an
    # owner-check (nothing to scope to; the Save is owner-scoped at the API).
    from adk.authoring_tools import add_element, set_artefact, set_lesson_prompt

    tc = _tc(TEACHER)
    assert set_lesson_prompt(text="Udforsk energi.", tool_context=tc)["ok"] is True
    assert add_element(element_kind="checklist", items=["a"], tool_context=tc)["ok"] is True
    assert set_artefact(artefact_id="boldkast", tool_context=tc)["ok"] is True
    # still requires an authenticated caller
    assert set_lesson_prompt(text="x", tool_context=_tc(None))["ok"] is False
    # an explicit, non-owned activity_id is still denied (the security boundary)
    other = _make_activity(OTHER)
    assert set_lesson_prompt(text="x", activity_id=other, tool_context=tc)["ok"] is False


# --- attach_material: curriculum reference docs (owner-scoped, ACL-scoped, propose-only) ---


def _make_curriculum(
    doc_id: str, *, owner_scope: str | None = None, level: str = "B", topic: str = "energi", summary: str = ""
) -> str:
    from datetime import UTC, datetime

    from db.curriculum import create_curriculum_doc
    from db.models.curriculum import SHARED_SCOPE, CurriculumDoc

    scope = owner_scope or SHARED_SCOPE
    now = datetime.now(UTC)
    create_curriculum_doc(
        CurriculumDoc(
            docId=doc_id,
            title=f"Doc {doc_id}",
            level=level,
            topic=topic,
            summary=summary,
            source="shared" if scope == SHARED_SCOPE else "teacher_upload",
            ownerScope=scope,
            origin="uvm.dk",
            copyrightStatus="cleared" if scope == SHARED_SCOPE else "teacher_owned",
            createdAt=now,
            updatedAt=now,
        )
    )
    return doc_id


def test_attach_material_owner_gets_a_curriculum_proposal():
    from adk.authoring_tools import attach_material

    did = _make_curriculum("energi-b")
    aid = _make_activity(TEACHER)
    res = attach_material(doc_id=did, activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is True
    assert res["proposal"]["kind"] == "attach_material"
    assert res["proposal"]["materialKind"] == "curriculum"
    assert res["proposal"]["docId"] == did
    assert res["proposal"]["origin"] == "uvm.dk"
    assert res["proposal"]["label"] == "Doc energi-b"


def test_attach_material_empty_or_unknown_id_lists_available():
    # Self-correcting like set_artefact: no/unknown id returns the docs the
    # teacher may attach so the agent retries with a valid docId.
    from adk.authoring_tools import attach_material

    _make_curriculum("shared-1", summary="Covers energy conservation for B-level.")
    aid = _make_activity(TEACHER)
    empty = attach_material(doc_id="", activity_id=aid, tool_context=_tc(TEACHER))
    unknown = attach_material(doc_id="nope", activity_id=aid, tool_context=_tc(TEACHER))
    assert empty["ok"] is False and unknown["ok"] is False
    assert "shared-1" in {d["docId"] for d in empty["available"]}
    assert "shared-1" in {d["docId"] for d in unknown["available"]}
    # 1.1.52 — the summary rides the available list so the co-pilot can judge fit.
    choice = next(d for d in empty["available"] if d["docId"] == "shared-1")
    assert choice["summary"] == "Covers energy conservation for B-level."


def test_attach_material_cannot_attach_another_teachers_private_doc():
    # ACL: a doc owned by OTHER (private upload) is NOT in TEACHER's allow-set,
    # so picking it by id is rejected AND it never appears in the available list.
    from adk.authoring_tools import attach_material

    _make_curriculum("shared-1")
    private = _make_curriculum("other-private", owner_scope=OTHER)
    aid = _make_activity(TEACHER)
    res = attach_material(doc_id=private, activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is False
    assert private not in {d["docId"] for d in res["available"]}


def test_attach_material_non_owner_activity_is_denied():
    from adk import authoring_tools

    did = _make_curriculum("energi-b")
    other_activity = _make_activity(OTHER)
    res = authoring_tools.attach_material(doc_id=did, activity_id=other_activity, tool_context=_tc(TEACHER))
    assert res["ok"] is False
    assert res.get("error") == authoring_tools._DENY["error"]


def test_attach_material_never_persists(monkeypatch):
    from adk import authoring_tools

    did = _make_curriculum("energi-b")
    aid = _make_activity(TEACHER)
    monkeypatch.setattr(
        authoring_tools, "save_activity", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not persist"))
    )
    res = authoring_tools.attach_material(doc_id=did, activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is True


# --- CONCEPT-1 M2: propose_concept_map (owner-scoped, propose-only, DIFF-based) ---


def _make_activity_with_map(owner: str = TEACHER) -> str:
    from db.activities import create_activity as _create
    from db.models.activity_config import ConceptEdge, ConceptMapElement, ConceptNode

    a = _create(
        Activity(
            activityId="",
            skillId="concept",
            ownerUid=owner,
            title="A",
            conceptMap=[
                ConceptMapElement(
                    id="concept-map-1",
                    nodes=[
                        ConceptNode(id="vektorer", label="Vektorer"),
                        ConceptNode(id="projektil", label="Projektil"),
                    ],
                    edges=[ConceptEdge.model_validate({"from": "vektorer", "to": "projektil"})],
                )
            ],
        )
    )
    return a.activity_id


def test_propose_concept_map_draft_add_nodes_and_edges():
    from adk.authoring_tools import propose_concept_map

    res = propose_concept_map(
        add_nodes=[
            {"label": "Vektorer"},
            {"label": "Trigonometri"},
            {
                "label": "Projektilbevægelse",
                "check_questions": [{"prompt": "Hvorfor en parabel?", "expected_answer": "konstant acceleration"}],
            },
        ],
        add_edges=[
            {"from": "vektorer", "to": "projektilbevaegelse"},
            {"from": "trigonometri", "to": "projektilbevaegelse"},
        ],
        tool_context=_tc(TEACHER),
    )
    assert res["ok"] is True, res
    p = res["proposal"]
    assert p["kind"] == "propose_concept_map"
    ids = [n["id"] for n in p["diff"]["addNodes"]]
    assert ids == ["vektorer", "trigonometri", "projektilbevaegelse"]
    assert p["diff"]["addNodes"][2]["checkQuestions"][0]["expectedAnswer"] == "konstant acceleration"
    # the server-validated RESULT map is included for the card's preview
    assert {n["id"] for n in p["result"]["nodes"]} == set(ids)
    assert len(p["result"]["edges"]) == 2


def test_propose_concept_map_diffs_against_the_saved_map():
    from adk.authoring_tools import propose_concept_map

    aid = _make_activity_with_map(TEACHER)
    res = propose_concept_map(
        add_nodes=[{"label": "Trigonometri"}],
        add_edges=[{"from": "trigonometri", "to": "projektil"}],
        relabel=[{"id": "projektil", "label": "Projektilbevægelse"}],
        activity_id=aid,
        tool_context=_tc(TEACHER),
    )
    assert res["ok"] is True, res
    result_nodes = {n["id"]: n["label"] for n in res["proposal"]["result"]["nodes"]}
    assert result_nodes["projektil"] == "Projektilbevægelse"
    assert "trigonometri" in result_nodes
    assert len(res["proposal"]["result"]["edges"]) == 2


def test_propose_concept_map_rejects_a_cycle_with_current_nodes():
    from adk.authoring_tools import propose_concept_map

    aid = _make_activity_with_map(TEACHER)
    res = propose_concept_map(
        add_edges=[{"from": "projektil", "to": "vektorer"}],  # closes the cycle
        activity_id=aid,
        tool_context=_tc(TEACHER),
    )
    assert res["ok"] is False
    assert "cycle" in res["error"].lower()
    # self-correcting: the current node ids come back so the agent can retry
    assert set(res["nodes"]) == {"vektorer", "projektil"}


def test_propose_concept_map_unknown_ref_is_self_correcting():
    from adk.authoring_tools import propose_concept_map

    aid = _make_activity_with_map(TEACHER)
    res = propose_concept_map(remove_nodes=["bogus"], activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is False
    assert set(res["nodes"]) == {"vektorer", "projektil"}


def test_propose_concept_map_remove_drops_incident_edges():
    from adk.authoring_tools import propose_concept_map

    aid = _make_activity_with_map(TEACHER)
    res = propose_concept_map(remove_nodes=["vektorer"], activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is True, res
    assert [n["id"] for n in res["proposal"]["result"]["nodes"]] == ["projektil"]
    assert res["proposal"]["result"]["edges"] == []


def test_propose_concept_map_non_owner_denied_and_empty_diff_rejected():
    from adk.authoring_tools import propose_concept_map

    aid = _make_activity_with_map(TEACHER)
    assert propose_concept_map(add_nodes=[{"label": "X"}], activity_id=aid, tool_context=_tc(OTHER))["ok"] is False
    assert propose_concept_map(activity_id=aid, tool_context=_tc(TEACHER))["ok"] is False


def test_propose_concept_map_never_persists(monkeypatch):
    from adk import authoring_tools

    aid = _make_activity_with_map(TEACHER)
    monkeypatch.setattr(
        authoring_tools, "save_activity", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not persist"))
    )
    res = authoring_tools.propose_concept_map(
        add_nodes=[{"label": "Trigonometri"}], activity_id=aid, tool_context=_tc(TEACHER)
    )
    assert res["ok"] is True
