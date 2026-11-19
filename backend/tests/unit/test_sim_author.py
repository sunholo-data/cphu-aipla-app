"""The sim-author skill's tools (in-app-sim-authoring M4).

No browser and no Firestore: the browser is a fake, the store is the in-memory
client. What is pinned:
- every check stores a version, owned by the caller, numbered per draft;
- screenshots reach the MODEL (inside the function response) but not the tool
  result, which streams to the teacher's card;
- the per-turn check cap, and a missing teacher or conversation refuse cleanly;
- a draft is invisible to anyone but its owner;
- the skill template parses and names only real tools.
"""

from __future__ import annotations

import base64
from pathlib import Path
from types import SimpleNamespace

import pytest

from adk import sim_author
from db import sim_drafts
from tests.unit.test_sim_gates import GOOD_HTML, GOOD_YAML

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class FakeBrowser:
    async def check(self, index_html: str, artefact_id: str, out_dir: Path) -> dict:
        out_dir.mkdir(parents=True, exist_ok=True)
        shots = {}
        for k in ("390", "700", "driven"):
            (out_dir / f"{k}.png").write_bytes(PNG)
            shots[k] = str(out_dir / f"{k}.png")
        return {
            "selfTest": "pass",
            "pageErrors": [],
            "checks": [{"ok": True, "msg": "390px: fits"}, {"ok": True, "msg": "700px: fits"}],
            "events": [{"kind": "demo-sim.run", "label": "Started", "state": {}}],
            "screenshots": shots,
        }


def ctx(uid: str = "teacher-1", session: str = "sess-1", invocation: str = "inv-1"):
    inv = SimpleNamespace(user_id=uid, session=SimpleNamespace(id=session), invocation_id=invocation)
    return SimpleNamespace(state={}, _invocation_context=inv)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    from db import firestore

    firestore._reset_client_for_testing()
    monkeypatch.setattr(sim_author, "browser_from_env", FakeBrowser)
    yield
    firestore._reset_client_for_testing()


@pytest.mark.asyncio
async def test_a_check_stores_a_version_and_parks_screenshots_for_the_model():
    c = ctx()
    result = await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=c)
    assert result["level"] == 3 and result["version"] == 1 and result["draft_id"] == "sess-1"
    assert "screenshots" not in result or all(not isinstance(v, str) or len(v) < 100 for v in result.values())
    parked = c.state[sim_author._scoped(sim_author.SHOTS_KEY, c)]
    assert len(parked) == 2  # 700 and driven, for the model

    draft = sim_drafts.get_draft("sess-1", "teacher-1")
    assert draft["latestVersion"] == 1 and draft["latestLevel"] == 3 and draft["title"] == "Demo"
    v1 = sim_drafts.get_version("sess-1", 1, "teacher-1")
    assert v1["html"] == GOOD_HTML and set(v1["screenshots"]) == {"390", "700", "driven"}


@pytest.mark.asyncio
async def test_each_check_is_a_new_version_of_the_same_draft():
    await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=ctx(invocation="a"))
    r2 = await sim_author.verify_sim(GOOD_HTML.replace("Demo", "Demo 2"), GOOD_YAML, tool_context=ctx(invocation="b"))
    assert r2["version"] == 2
    assert sim_drafts.get_draft("sess-1", "teacher-1")["latestVersion"] == 2


@pytest.mark.asyncio
async def test_a_draft_is_invisible_to_another_teacher_and_cannot_be_written_by_one():
    await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=ctx())
    assert sim_drafts.get_draft("sess-1", "teacher-2") is None
    assert sim_drafts.get_version("sess-1", 1, "teacher-2") is None
    other = await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=ctx(uid="teacher-2"))
    assert other["version"] is None  # refused to store; the verdict still came back
    assert other["level"] == 3


@pytest.mark.asyncio
async def test_the_per_turn_cap_refuses_without_running():
    c = ctx()
    for _ in range(sim_author.MAX_CHECKS_PER_TURN):
        await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=c)
    over = await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=c)
    assert over["ok"] is False and "limit" in over["refused"]


@pytest.mark.asyncio
async def test_no_teacher_or_no_conversation_refuses():
    no_user = SimpleNamespace(
        state={}, _invocation_context=SimpleNamespace(user_id=None, session=None, invocation_id="x")
    )
    r = await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=no_user)
    assert r["ok"] is False and "refused" in r


@pytest.mark.asyncio
async def test_screenshots_are_attached_inside_the_verify_sim_response():
    from google.genai import types

    c = ctx()
    await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=c)
    fr = types.FunctionResponse(name="verify_sim", response={"level": 3})
    request = SimpleNamespace(contents=[types.Content(role="user", parts=[types.Part(function_response=fr)])])
    assert await sim_author.attach_sim_screenshots(c, request) is True
    assert len(request.contents[-1].parts[0].function_response.parts) == 2
    # parked once, attached once
    assert await sim_author.attach_sim_screenshots(c, request) is False


@pytest.mark.asyncio
async def test_read_reference_serves_both_topics_and_refuses_others():
    rules = await sim_author.read_reference("authoring-rules")
    kit = await sim_author.read_reference("anatomy-kit")
    assert "@aipla-bridge" in rules and "/vendor/anatomy-kit/" in kit
    assert "Unknown topic" in await sim_author.read_reference("../../etc/passwd")


def test_the_template_parses_and_names_only_registered_tools():
    from adk.tools import TOOL_REGISTRY
    from admin.platform_seed import _parse_template
    from db.models import SkillMetadata

    parsed = _parse_template(Path(__file__).resolve().parents[2] / "skills" / "templates" / "sim-author" / "SKILL.md")
    meta = SkillMetadata.model_validate(parsed["metadata"])
    assert parsed["accessControl"] == {"type": "tagged", "tags": ["role:teacher"]}
    assert meta.thinking_budget and meta.thinking_budget > 0
    assert set(parsed["metadata"]["tools"]) <= set(TOOL_REGISTRY)


def test_the_kit_load_tag_in_the_guide_matches_the_vendor_manifest():
    """The guide tells the model the exact script tag; a re-sync that changes the
    kit's hash must change the guide too, or every kit sim fails A.vendor_scripts."""
    import json
    import re

    repo = Path(__file__).resolve().parents[3]
    manifest = json.loads((repo / "infrastructure" / "mcp-sandbox" / "vendor.json").read_text())
    kit = manifest["libraries"]["anatomy-kit"]
    guide = (sim_author.REFERENCES / "anatomy-lite.md").read_text()
    m = re.search(r'src="(/vendor/anatomy-kit/[^"]+)"\s+integrity="sha384-([^"]+)"', guide)
    assert m, "the guide has no kit script tag"
    assert m.group(1) == f"/vendor/anatomy-kit/{kit['version']}/iso-kit.js"
    assert m.group(2) == kit["files"]["iso-kit.js"]["sha384"]


@pytest.mark.asyncio
async def test_hidden_terms_reach_the_check():
    shown = GOOD_HTML.replace('start: "Start", label: "Startede', 'start: "Start", g: "g = 9,82", label: "Startede')
    shown = shown.replace('start: "Start", label: "Started', 'start: "Start", g: "g = 9.82", label: "Started')
    r = await sim_author.verify_sim(shown, GOOD_YAML, hidden_terms=["9,82"], tool_context=ctx())
    assert r["ok"] is False  # level may be 3; a leaked answer is still not ok
    assert any(f["id"] == "D.hidden_terms" for f in r["static_failures"])


# ---- editing instead of rewriting ----------------------------------------------------


@pytest.mark.asyncio
async def test_edit_sim_changes_the_stored_draft_and_stores_a_new_version():
    await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=ctx(invocation="a"))
    r = await sim_author.edit_sim(
        [{"find": 'intro: "Et pendul."', "replace": 'intro: "Et matematisk pendul."'}],
        tool_context=ctx(invocation="b"),
    )
    assert r["applied"] == 1 and r["edited_from_version"] == 1 and r["version"] == 2 and r["level"] == 3
    v2 = sim_drafts.get_version("sess-1", 2, "teacher-1")
    assert 'intro: "Et matematisk pendul."' in v2["html"] and v2["yaml"] == GOOD_YAML


@pytest.mark.asyncio
async def test_a_missing_or_ambiguous_find_changes_nothing():
    await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=ctx(invocation="a"))
    missing = await sim_author.edit_sim([{"find": "no such text", "replace": "x"}], tool_context=ctx(invocation="b"))
    assert missing["ok"] is False and "not found" in missing["refused"]
    twice = await sim_author.edit_sim([{"find": "Start", "replace": "Go"}], tool_context=ctx(invocation="c"))
    assert twice["ok"] is False and "times" in twice["refused"]
    partly = await sim_author.edit_sim(
        [{"find": 'intro: "Et pendul."', "replace": "ok"}, {"find": "no such text", "replace": "x"}],
        tool_context=ctx(invocation="d"),
    )
    assert partly["ok"] is False
    assert sim_drafts.get_draft("sess-1", "teacher-1")["latestVersion"] == 1  # nothing stored


@pytest.mark.asyncio
async def test_edit_sim_without_a_draft_says_to_write_one_first():
    r = await sim_author.edit_sim([{"find": "a", "replace": "b"}], tool_context=ctx())
    assert r["ok"] is False and "verify_sim" in r["refused"]


@pytest.mark.asyncio
async def test_read_sim_serves_line_ranges_and_search():
    await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=ctx())
    page = await sim_author.read_sim(start_line=1, end_line=3, tool_context=ctx(invocation="r"))
    assert page["version"] == 1 and page["lines"].startswith("1: <!doctype html>")
    hit = await sim_author.read_sim(search="ARTEFACT_NAME =", tool_context=ctx(invocation="r2"))
    assert 'const ARTEFACT_NAME = "demo-sim";' in hit["lines"]
    yml = await sim_author.read_sim(file="catalogue.yaml", tool_context=ctx(invocation="r3"))
    assert "id: demo-sim" in yml["lines"]


@pytest.mark.asyncio
async def test_screenshots_attach_to_edit_sim_responses_too():
    from google.genai import types

    await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=ctx(invocation="a"))
    c = ctx(invocation="b")
    await sim_author.edit_sim([{"find": 'intro: "Et pendul."', "replace": 'intro: "Pendul."'}], tool_context=c)
    fr = types.FunctionResponse(name="edit_sim", response={"level": 3})
    request = SimpleNamespace(contents=[types.Content(role="user", parts=[types.Part(function_response=fr)])])
    assert await sim_author.attach_sim_screenshots(c, request) is True


@pytest.mark.asyncio
async def test_read_sim_takes_several_search_terms_in_one_call():
    await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=ctx())
    hit = await sim_author.read_sim(search=["ARTEFACT_NAME =", "TEST PASS"], tool_context=ctx(invocation="r"))
    assert "ARTEFACT_NAME" in hit["lines"] and "TEST PASS" in hit["lines"]


@pytest.mark.asyncio
async def test_a_teacher_without_the_feature_is_refused_by_every_tool(monkeypatch):
    import auth.features

    monkeypatch.setattr(auth.features, "has_feature_for_uid", lambda uid, feature: False)
    for result in (
        await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=ctx(invocation="a")),
        await sim_author.read_sim(tool_context=ctx(invocation="b")),
        await sim_author.edit_sim([{"find": "a", "replace": "b"}], tool_context=ctx(invocation="c")),
    ):
        assert result["ok"] is False and result["refused"] == sim_author.NOT_ENABLED
    assert sim_drafts.get_draft("sess-1", "teacher-1") is None  # nothing ran, nothing stored


# ---- usage: what a simulation has cost so far ----------------------------------------


def _llm_response(tokens_in: int, out: int, thoughts: int, partial: bool = False, cached: int = 0) -> SimpleNamespace:
    return SimpleNamespace(
        partial=partial,
        model_version="gemini-3.8-flash",
        usage_metadata=SimpleNamespace(
            prompt_token_count=tokens_in,
            candidates_token_count=out,
            thoughts_token_count=thoughts,
            cached_content_token_count=cached,
        ),
    )


@pytest.mark.asyncio
async def test_usage_accumulates_on_the_draft_and_skips_partial_chunks():
    c = ctx()
    await sim_author.record_sim_usage(c, _llm_response(50_000, 15_000, 20_000))
    await sim_author.record_sim_usage(c, _llm_response(60_000, 1_000, 2_000, partial=True))  # not counted
    await sim_author.record_sim_usage(c, _llm_response(70_000, 2_000, 4_000))
    usage = sim_drafts.get_draft("sess-1", "teacher-1")["usage"]
    assert usage["tokensIn"] == 120_000 and usage["tokensOut"] == 17_000 and usage["tokensThinking"] == 24_000
    assert usage["calls"] == 2 and usage["costUsd"] > 0


@pytest.mark.asyncio
async def test_usage_records_the_cached_part_of_the_prompt(caplog):
    c = ctx()
    with caplog.at_level("INFO", logger="adk.sim_author"):
        await sim_author.record_sim_usage(c, _llm_response(50_000, 1_000, 2_000, cached=40_000))
        await sim_author.record_sim_usage(c, _llm_response(52_000, 1_000, 2_000))  # no cache hit
    usage = sim_drafts.get_draft("sess-1", "teacher-1")["usage"]
    assert usage["tokensIn"] == 102_000 and usage["tokensCached"] == 40_000
    assert any("in=50000 cached=40000" in r.getMessage() for r in caplog.records)


@pytest.mark.asyncio
async def test_usage_never_writes_into_another_teachers_draft():
    await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=ctx())
    await sim_author.record_sim_usage(ctx(uid="teacher-2"), _llm_response(1_000, 100, 0))
    assert "usage" not in sim_drafts.get_draft("sess-1", "teacher-1")


# ---- the request is the model's view; the session is the record ----------------------


def _as_request(*contents):
    """The request ADK would build from these stored contents: shallow copies whose
    function_response objects are SHARED with the stored ones (as in ADK 2.x)."""
    from google.adk.flows.llm_flows.context._contents import _copy_content_for_request

    return SimpleNamespace(
        contents=[_copy_content_for_request(c, strip_client_function_call_ids=False) for c in contents]
    )


def _response(name: str, response: dict):
    from google.genai import types

    return types.Content(
        role="user", parts=[types.Part(function_response=types.FunctionResponse(name=name, response=response))]
    )


@pytest.mark.asyncio
async def test_screenshots_never_land_in_the_stored_session_event():
    c = ctx()
    await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=c)
    stored = _response("verify_sim", {"level": 3, "version": 1})
    req = _as_request(stored)
    assert await sim_author.attach_sim_screenshots(c, req) is True
    assert len(req.contents[-1].parts[0].function_response.parts) == 2
    assert stored.parts[0].function_response.parts is None, "re-sent on every later call if it did"


@pytest.mark.asyncio
async def test_prune_shortens_reads_of_replaced_versions_and_keeps_the_current_ones():
    old = _response("read_sim", {"ok": True, "version": 1, "file": "index.html", "lines": "10: a\n11: b\n12: c"})
    edit = _response("edit_sim", {"ok": True, "version": 2, "level": 3})
    cur = _response("read_sim", {"ok": True, "version": 2, "file": "index.html", "lines": "10: a2"})
    req = _as_request(old, edit, cur)
    assert await sim_author.prune_stale_sim_reads(ctx(), req) == 1
    pruned = req.contents[0].parts[0].function_response.response
    assert "lines" not in pruned and "lines 10-12" in pruned["pruned"] and "version 2" in pruned["pruned"]
    assert req.contents[2].parts[0].function_response.response["lines"] == "10: a2"
    # the session keeps everything: only this request was shortened
    assert old.parts[0].function_response.response["lines"].startswith("10: a")


@pytest.mark.asyncio
async def test_prune_is_stable_until_a_new_version_appears():
    """Same input, same output: a context cache keyed on the prefix stays valid."""
    contents = [
        _response("read_sim", {"ok": True, "version": 1, "file": "index.html", "lines": "1: x"}),
        _response("verify_sim", {"version": 2, "level": 3}),
    ]
    a, b = _as_request(*contents), _as_request(*contents)
    await sim_author.prune_stale_sim_reads(ctx(), a)
    await sim_author.prune_stale_sim_reads(ctx(), b)
    assert a.contents[0].parts[0].function_response.response == b.contents[0].parts[0].function_response.response
    # and pruning an already-pruned request changes nothing
    assert await sim_author.prune_stale_sim_reads(ctx(), a) == 0


@pytest.mark.asyncio
async def test_prune_keeps_only_the_last_read_of_the_same_guide():
    guide = {"result": "AUTHORING RULES …" + "x" * 500}
    req = _as_request(_response("read_reference", guide), _response("read_reference", dict(guide)))
    assert await sim_author.prune_stale_sim_reads(ctx(), req) == 1
    assert "pruned" in req.contents[0].parts[0].function_response.response
    assert req.contents[1].parts[0].function_response.response == guide


@pytest.mark.asyncio
async def test_prune_leaves_a_conversation_with_one_version_alone():
    req = _as_request(
        _response("read_sim", {"ok": True, "version": 1, "file": "index.html", "lines": "1: x"}),
        _response("read_sim", {"ok": True, "version": 1, "file": "index.html", "lines": "2: y"}),
    )
    assert await sim_author.prune_stale_sim_reads(ctx(), req) == 0


@pytest.mark.asyncio
async def test_read_sim_can_read_an_earlier_version_and_says_it_is_not_current():
    await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=ctx(invocation="a"))
    await sim_author.edit_sim(
        [{"find": 'intro: "Et pendul."', "replace": 'intro: "Et matematisk pendul."'}], tool_context=ctx(invocation="b")
    )
    v1 = await sim_author.read_sim(search="intro:", version=1, tool_context=ctx(invocation="c"))
    assert v1["version"] == 1 and 'intro: "Et pendul."' in v1["lines"] and "current one is 2" in v1["note"]
    now = await sim_author.read_sim(search="intro:", tool_context=ctx(invocation="d"))
    assert now["version"] == 2 and "note" not in now
    missing = await sim_author.read_sim(version=7, tool_context=ctx(invocation="e"))
    assert missing["ok"] is False and "1 to 2" in missing["refused"]


@pytest.mark.asyncio
async def test_check_sim_rechecks_the_stored_draft_without_storing_or_resending():
    """An imported sim: the model used to re-check it with a no-op edit_sim, leaving
    the teacher a version identical to the last (prod, 2026-11-19)."""
    from google.genai import types

    await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=ctx(invocation="a"))
    c = ctx(invocation="b")
    r = await sim_author.check_sim(tool_context=c)
    assert r["version"] == 1 and r["stored"] is False and r["level"] == 3
    assert sim_drafts.get_draft("sess-1", "teacher-1")["latestVersion"] == 1, "no new version"
    req = SimpleNamespace(contents=[_response("check_sim", r)])
    assert await sim_author.attach_sim_screenshots(c, req) is True
    assert isinstance(req.contents[0].parts[0].function_response.parts[0], types.FunctionResponsePart)


@pytest.mark.asyncio
async def test_check_sim_counts_against_the_per_turn_cap_and_needs_a_draft():
    assert (await sim_author.check_sim(tool_context=ctx()))["ok"] is False  # nothing stored yet
    await sim_author.verify_sim(GOOD_HTML, GOOD_YAML, tool_context=ctx(invocation="a"))
    c = ctx(invocation="b")
    for _ in range(sim_author.MAX_CHECKS_PER_TURN):
        assert "refused" not in await sim_author.check_sim(tool_context=c)
    assert "limit" in (await sim_author.check_sim(tool_context=c))["refused"]
