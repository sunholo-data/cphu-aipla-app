"""The tutor co-pilot's propose-tools (1.1.91 M2).

The headline property, and the reason most of this file exists: **the co-pilot
cannot write a citation.** 1.1.91 states that as a hard requirement, so it is
tested as one — at the tool boundary, not by reading the prompt.
"""

from __future__ import annotations

import asyncio

import pytest

from adk import tutor_authoring_tools as t

#: The REAL implementation, captured before the autouse fixture replaces it —
#: otherwise a test of the gate itself would be testing the stub.
_real_is_researcher = t._caller_is_researcher


class _Ctx:
    """Minimal stand-in for ToolContext — only the uid path is consulted."""

    def __init__(self, uid: str = "r-1"):
        self.state = {"user:id": uid}


@pytest.fixture(autouse=True)
def _researcher(monkeypatch):
    """Default: the caller IS a researcher. Individual tests override."""
    monkeypatch.setattr(t, "_caller_is_researcher", lambda ctx: True)


# ── the never-invent-a-citation rule ─────────────────────────────────────────


def test_a_proposal_cannot_carry_a_citation_the_model_wrote():
    """Layer 2 of the rule. The model is not asked to behave — its output is
    structurally incapable of carrying a reference."""
    out = t.propose_approach(
        label="Self-determination theory",
        summary="Autonomy, competence, relatedness.",
        construct_names=["autonomy", "competence"],
        tool_context=_Ctx(),
    )
    assert out["ok"] is True
    assert out["proposal"]["provenance"] == []
    assert "cannot carry a reference" in out["proposal"]["needsVouching"]


def test_citation_fields_are_stripped_from_constructs():
    """Whatever shape a model invents them in, they do not survive."""
    dirty = [
        {"name": "autonomy", "citation": "Deci & Ryan (1985)"},
        {"name": "competence", "sources": ["made up"], "provenance": [{"citation": "x"}]},
    ]
    cleaned = t._strip_provenance(dirty)
    blob = repr(cleaned)
    assert "Deci" not in blob
    assert "made up" not in blob
    assert [c["name"] for c in cleaned] == ["autonomy", "competence"]


def test_the_only_citations_offered_come_from_the_approachs_own_provenance(monkeypatch):
    """`find_source_passages` does not generate a reference — it pairs retrieved
    text with the citation already vouched in the framework's YAML."""
    from db import literature_corpus as lit

    async def fake_query(q, *, top_k=5, framework_id=None):
        return [{"text": "the eliciting phase ...", "frameworkId": "esru", "score": 0.3}]

    monkeypatch.setattr(lit, "get_literature_corpus_name", lambda: "projects/p/locations/europe-north1/ragCorpora/1")
    monkeypatch.setattr(lit, "query_literature", fake_query)

    out = asyncio.run(t.find_source_passages("esru", "wait time", tool_context=_Ctx()))
    assert out["ok"] and out["configured"] is True
    assert out["passages"][0]["frameworkId"] == "esru"
    # Every citation is vouched by a HUMAN, from the YAML.
    assert out["citations"]
    assert all(c["vouchedBy"] for c in out["citations"])
    assert any("Ruiz-Primo" in c["citation"] for c in out["citations"])
    assert "Never write a reference that is not in that list" in out["note"]


def test_an_unconfigured_corpus_is_reported_not_rendered_as_no_passages(monkeypatch):
    from db import literature_corpus as lit

    monkeypatch.setattr(lit, "get_literature_corpus_name", lambda: None)
    out = asyncio.run(t.find_source_passages("esru", "wait time", tool_context=_Ctx()))
    assert out["configured"] is False
    assert out["passages"] == []


def test_a_custom_approach_has_no_literature_to_search(monkeypatch):
    from db.models.teaching_framework import TeachingFramework

    monkeypatch.setattr(
        t,
        "_guard",
        lambda ctx: None,
    )
    import db.framework_overrides as fo

    monkeypatch.setattr(
        fo,
        "effective_framework",
        lambda fid: TeachingFramework(id=fid, label="Warm coach", layer="custom", status="ready"),
    )
    out = asyncio.run(t.find_source_passages("custom-warm-coach", "kindness", tool_context=_Ctx()))
    assert out["ok"] is False
    assert "authored, not drafted" in out["error"]


# ── the researcher gate ──────────────────────────────────────────────────────


def test_a_non_researcher_is_refused_on_every_tool(monkeypatch):
    monkeypatch.setattr(t, "_caller_is_researcher", lambda ctx: False)
    ctx = _Ctx("teacher-1")
    assert t.propose_approach("X", construct_names=["a"], tool_context=ctx)["ok"] is False
    assert t.propose_behaviours("a", ["do a thing"], tool_context=ctx)["ok"] is False
    assert t.draft_approach_prompt("esru", tool_context=ctx)["ok"] is False
    assert t.critique_approach("esru", tool_context=ctx)["ok"] is False
    assert asyncio.run(t.find_source_passages("esru", "q", tool_context=ctx))["ok"] is False


def test_an_unreadable_claim_is_reported_apart_from_a_refusal(monkeypatch):
    """A gate that cannot tell "no" from "don't know" turns an outage into an
    authorization answer. Both refuse; they must not say the same thing."""
    monkeypatch.setattr(t, "_caller_is_researcher", lambda ctx: None)
    out = t.propose_approach("X", construct_names=["a"], tool_context=_Ctx())
    assert out["ok"] is False
    assert "failed check, not a refusal" in out["error"]
    assert out["error"] != t._DENY["error"]


def test_no_identity_reads_as_not_a_researcher_not_as_unreadable(monkeypatch):
    """No uid is a definite "not a researcher", not an unreadable claim — there
    is nothing to fail to read."""
    monkeypatch.setattr(t, "_caller_uid", lambda ctx: None)
    assert _real_is_researcher(None) is False


def test_an_admin_sdk_failure_reads_as_UNREADABLE_not_as_a_refusal(monkeypatch):
    """The three-valued gate's whole point, at the real function."""
    monkeypatch.setattr(t, "_caller_uid", lambda ctx: "r-1")

    import firebase_admin.auth as fb_auth

    def boom(uid):
        raise RuntimeError("transport failed")

    monkeypatch.setattr(fb_auth, "get_user", boom)
    assert _real_is_researcher(_Ctx()) is None


# ── the rest of the surface ──────────────────────────────────────────────────


def test_an_approach_needs_at_least_one_construct():
    out = t.propose_approach("Nameless pedagogy", construct_names=[], tool_context=_Ctx())
    assert out["ok"] is False
    assert "at least one construct" in out["error"]


def test_behaviours_are_proposed_with_their_avoid_list():
    out = t.propose_behaviours(
        "elicit",
        behaviours=["Ask the student to predict what will happen.", "  "],
        avoid=["Say 'Good!' before they have explained anything."],
        tool_context=_Ctx(),
    )
    assert out["ok"] is True
    assert out["proposal"]["behaviours"] == [{"text": "Ask the student to predict what will happen."}]
    assert out["proposal"]["avoid"][0].startswith("Say 'Good!'")


def test_draft_prompt_uses_the_real_generator_not_a_guess():
    """An approximation would drift from what the tutor is really told, which is
    the failure this whole layer exists to prevent."""
    from frameworks.instruction import build_framework_instruction
    from frameworks.loader import load_framework

    out = t.draft_approach_prompt("esru", tool_context=_Ctx())
    assert out["ok"] is True
    assert out["instruction"] == build_framework_instruction(load_framework("esru"))
    assert "not an approximation" in out["note"]


def test_critique_measures_rather_than_invents():
    out = t.critique_approach("esru", tool_context=_Ctx())
    assert out["ok"] is True
    o = out["observations"]
    assert o["constructs"] > 0 and o["behaviours"] > 0
    assert o["askOrElicitMoves"] > 0  # ESRU is built from eliciting
    assert o["sources"] > 0
    assert o["unvouchedSources"] == []  # every shipped citation is vouched
    assert "do not add findings" in out["note"]


def test_critique_surfaces_the_register_contradiction(monkeypatch):
    """The 1.1.111 clash, reported while editing rather than found in a
    transcript."""
    import db.framework_overrides as fo
    from frameworks.loader import load_framework

    esru = load_framework("esru").model_copy(update={"teaching_register": "concise"})
    monkeypatch.setattr(fo, "effective_framework", lambda fid: esru)

    out = t.critique_approach("esru", tool_context=_Ctx())
    conflict = out["observations"]["registerConflict"]
    assert conflict and "not to end with a follow-up question" in conflict


def test_an_unknown_approach_is_a_clean_error():
    assert t.draft_approach_prompt("no-such-thing", tool_context=_Ctx())["ok"] is False
    assert t.critique_approach("no-such-thing", tool_context=_Ctx())["ok"] is False
