"""svg-illustrator: the drawing agent sees its own diagram (adk/svg_preview.py).

The chain has three links and each is invisible from the others: the tool must
park the PNG, the before-model hook must put it INSIDE the matching function
response (the only shape Gemini accepts — verified live 2026-10-12), and the
image check must count it so grounding is stripped. The template half is netted
too: a tutor naming an ``agentTools`` skill that is not a template is a feature
that silently is not there (create_agent warns and skips).
"""

from __future__ import annotations

import asyncio
import base64
from pathlib import Path
from types import SimpleNamespace

import pytest
from google.genai import types

from adk.agent import _request_has_image_part
from adk.svg_preview import (
    LAST_GOOD_KEY,
    NO_DIAGRAM,
    PREVIEW_STATE_KEY,
    TOOL_NAME,
    attach_svg_preview,
    lint_svg,
    make_final_svg_guard,
    render_svg_png,
    render_svg_preview,
    scoped,
)
from adk.tools import TOOL_REGISTRY
from admin.platform_seed import DEFAULT_TEMPLATES_ROOT, _parse_template

GOOD = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160" stroke="currentColor" fill="none">'
    '<line x1="20" y1="140" x2="220" y2="140" stroke="#78716c"/>'
    '<text x="100" y="80" font-size="11" fill="#1e40af" stroke="none">v₀</text>'
    "</svg>"
)
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


# --- lint ---


def test_a_clean_diagram_has_no_problems():
    assert lint_svg(GOOD) == []


def test_text_inheriting_a_stroke_is_flagged():
    """The fault the old prompt recipe produced: root stroke="currentColor"
    smears every label. It shipped in two tutor prompts."""
    svg = GOOD.replace(' stroke="none">v₀', ">v₀")
    problems = lint_svg(svg)
    assert any("inherits stroke" in p for p in problems)


def test_text_inheriting_a_stroke_via_style_is_flagged():
    svg = (
        '<svg viewBox="0 0 100 100"><g style="stroke: #000; fill:none">'
        '<text x="10" y="10" fill="#000">a</text></g></svg>'
    )
    assert any("inherits stroke" in p for p in lint_svg(svg))


@pytest.mark.parametrize("label", ["v_0", "v_{x}", "40^\\circ", "$v_0$", "\\theta"])
def test_latex_in_a_label_is_flagged(label):
    """First live run: the maths-notation preamble reached the illustrator and it
    drew "v_0" and "40^\\circ" as literal characters."""
    svg = f'<svg viewBox="0 0 100 100"><text x="10" y="10" stroke="none">{label}</text></svg>'
    assert any("LaTeX" in p for p in lint_svg(svg))


@pytest.mark.parametrize("label", ["v₀", "40°", "Δt", "λ = ?"])
def test_unicode_labels_are_not_mistaken_for_latex(label):
    svg = f'<svg viewBox="0 0 100 100"><text x="10" y="10" stroke="none">{label}</text></svg>'
    assert lint_svg(svg) == []


@pytest.mark.parametrize(
    ("snippet", "expected"),
    [
        ('<use href="#a"/>', "<use> is stripped"),
        ('<image href="x.png" width="1" height="1"/>', "<image> is stripped"),
        ('<rect width="1" height="1" onclick="x()"/>', "onclick"),
        ('<a href="https://x"><rect width="1" height="1"/></a>', "href attribute"),
    ],
)
def test_what_the_chat_sanitiser_strips_is_flagged(snippet, expected):
    svg = f'<svg viewBox="0 0 100 100">{snippet}</svg>'
    assert any(expected in p for p in lint_svg(svg))


def test_missing_viewbox_is_flagged():
    assert any("viewBox" in p for p in lint_svg('<svg width="100" height="100"></svg>'))


def test_a_label_outside_the_frame_is_flagged():
    svg = '<svg viewBox="0 0 100 100"><text x="140" y="50" stroke="none">θ</text></svg>'
    assert any("outside the viewBox" in p for p in lint_svg(svg))


def test_a_transformed_label_is_not_guessed_at():
    svg = '<svg viewBox="0 0 100 100"><g transform="translate(-100 0)"><text x="140" y="50">θ</text></g></svg>'
    assert not any("outside the viewBox" in p for p in lint_svg(svg))


def test_malformed_and_doctype_are_refused_without_parsing():
    assert any("not well-formed" in p for p in lint_svg("<svg><line></svg>"))
    assert any("DOCTYPE" in p for p in lint_svg('<!DOCTYPE svg [<!ENTITY a "b">]><svg/>'))


# --- render ---


def test_render_produces_a_png():
    assert render_svg_png(GOOD).startswith(PNG_MAGIC)


def test_render_tolerates_a_missing_namespace():
    """Browsers forgive a bare <svg>; resvg does not. Models omit it routinely."""
    assert render_svg_png('<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="red"/></svg>').startswith(
        PNG_MAGIC
    )


# --- the tool ---


def test_tool_parks_the_png_and_reports_rendered():
    ctx = SimpleNamespace(state={})
    result = asyncio.run(render_svg_preview(GOOD, tool_context=ctx))
    assert result["rendered"] is True
    assert result["problems"] == []
    assert base64.b64decode(ctx.state[scoped(PREVIEW_STATE_KEY, ctx)]).startswith(PNG_MAGIC)


def test_tool_reports_an_unrenderable_svg_instead_of_raising():
    ctx = SimpleNamespace(state={})
    result = asyncio.run(render_svg_preview("not svg at all", tool_context=ctx))
    assert result["rendered"] is False
    assert result["problems"]
    assert scoped(PREVIEW_STATE_KEY, ctx) not in ctx.state


def test_tool_is_registered_for_skill_frontmatter():
    assert TOOL_NAME in TOOL_REGISTRY


# --- attach (before-model) ---


def _request_after_tool_call(name: str = TOOL_NAME) -> SimpleNamespace:
    return SimpleNamespace(
        contents=[
            types.Content(role="user", parts=[types.Part(text="draw it")]),
            types.Content(role="model", parts=[types.Part(function_call=types.FunctionCall(name=name, args={}))]),
            types.Content(
                role="user",
                parts=[types.Part(function_response=types.FunctionResponse(name=name, response={"rendered": True}))],
            ),
        ]
    )


def _parked_state() -> dict:
    ctx = SimpleNamespace(state={})
    asyncio.run(render_svg_preview(GOOD, tool_context=ctx))
    return ctx.state


def test_attach_puts_the_png_inside_the_function_response():
    """INSIDE, not beside: an image Part next to a function response in the same
    Content is rejected by Gemini (400 'Requests ending with a model turn')."""
    state = _parked_state()
    req = _request_after_tool_call()
    assert asyncio.run(attach_svg_preview(SimpleNamespace(state=state), req)) is True
    last = req.contents[-1]
    assert len(last.parts) == 1, "no sibling Part may be added"
    fr_parts = last.parts[0].function_response.parts
    assert fr_parts[0].inline_data.mime_type == "image/png"
    assert fr_parts[0].inline_data.data.startswith(PNG_MAGIC)
    assert not state[scoped(PREVIEW_STATE_KEY, SimpleNamespace())], "one image per render: the key is consumed"


def test_attach_is_a_no_op_for_agents_that_never_rendered():
    req = _request_after_tool_call()
    assert asyncio.run(attach_svg_preview(SimpleNamespace(state={}), req)) is False
    assert req.contents[-1].parts[0].function_response.parts is None


def test_attach_also_lands_on_the_physics_tools_response():
    req = _request_after_tool_call(name="draw_physics_diagram")
    assert asyncio.run(attach_svg_preview(SimpleNamespace(state=_parked_state()), req)) is True


def test_a_label_on_a_line_is_measured_not_left_to_the_models_eyes():
    """First live run: "40°" sat on the v0 arrow and the model, looking at its own
    render, passed it. Geometry flags it; a label clear of the line is not flagged."""
    on = '<svg viewBox="0 0 240 160"><line x1="40" y1="130" x2="100" y2="80"/><text x="68" y="108">40°</text></svg>'
    off = '<svg viewBox="0 0 240 160"><line x1="40" y1="130" x2="100" y2="80"/><text x="80" y="125">40°</text></svg>'
    assert any("overlaps a line" in p for p in lint_svg(on))
    assert not any("overlaps a line" in p for p in lint_svg(off))


def test_attach_never_lands_on_another_tools_response():
    req = _request_after_tool_call(name="something_else")
    assert asyncio.run(attach_svg_preview(SimpleNamespace(state=_parked_state()), req)) is False
    assert req.contents[-1].parts[0].function_response.parts is None


def test_a_preview_turn_counts_as_multimodal_for_grounding():
    """Gemini 400s on grounding + image input; the strip keys off this check."""
    req = _request_after_tool_call()
    assert _request_has_image_part(req) is False
    asyncio.run(attach_svg_preview(SimpleNamespace(state=_parked_state()), req))
    assert _request_has_image_part(req) is True


# --- templates ---


def _templates() -> dict[str, dict]:
    return {
        parsed["name"]: parsed
        for parsed in (_parse_template(p) for p in sorted(Path(DEFAULT_TEMPLATES_ROOT).glob("*/SKILL.md")))
    }


def test_every_agent_tools_entry_names_a_shipped_template():
    """create_agent resolves agentTools by slug and only WARNS on a miss, so a
    typo here ships a tutor told to call a tool that does not exist."""
    templates = _templates()
    for name, parsed in templates.items():
        for ref in parsed["metadata"].get("agentTools") or []:
            assert ref in templates, f"{name} delegates to {ref!r}, which is not a template"


def test_every_template_tool_resolves():
    for name, parsed in _templates().items():
        for tool in parsed["metadata"].get("tools") or []:
            assert tool in TOOL_REGISTRY or tool in {"ai_search", "google_search", "code_execution", "mcp"}, (
                f"{name} declares unknown tool {tool!r}"
            )


def test_the_illustrator_is_reachable_by_no_person():
    """Internal: only reachable as an agentTools entry. A tag nobody carries."""
    access = _templates()["svg-illustrator"]["accessControl"]
    assert access["type"] == "tagged"
    assert access["tags"] == ["role:internal-agent-tool"]


def test_the_drawing_tutors_delegate_instead_of_drawing_blind():
    templates = _templates()
    for name in ("concept-dialogue", "problem-set-hints"):
        assert "svg-illustrator" in templates[name]["metadata"]["agentTools"]
        assert "svg_illustrator" in templates[name]["instructions"]
        # Delivered by IllustrationCard from the tool result: a tutor told to
        # paste the block dropped it two times in three in live runs.
        assert "Do not paste" in templates[name]["instructions"]
        assert 'stroke="currentColor"' not in templates[name]["instructions"], "the old blind recipe is back"


# --- only a checked diagram reaches the student ---


def _final(text: str):
    return SimpleNamespace(partial=False, content=types.Content(role="model", parts=[types.Part(text=text)]))


def test_the_answer_is_replaced_by_the_last_checked_diagram():
    """Live: the model REWROTE a correct computed diagram in its answer, and once
    hand-drew an unchecked one with the block floating off the slope."""
    ctx = SimpleNamespace(state={})
    asyncio.run(render_svg_preview(GOOD, tool_context=ctx))
    response = _final("```svg\n<svg viewBox='0 0 9 9'><text>rewritten by hand</text></svg>\n```")
    asyncio.run(make_final_svg_guard()(ctx, response))
    assert response.content.parts[0].text == f"```svg\n{GOOD}\n```"


def test_with_nothing_checked_no_diagram_is_delivered():
    ctx = SimpleNamespace(state={})
    response = _final("```svg\n<svg viewBox='0 0 9 9'/>\n```")
    asyncio.run(make_final_svg_guard()(ctx, response))
    assert response.content.parts[0].text == NO_DIAGRAM


def test_the_guard_leaves_mid_loop_and_streaming_responses_alone():
    guard = make_final_svg_guard()
    call = SimpleNamespace(
        partial=False,
        content=types.Content(role="model", parts=[types.Part(function_call=types.FunctionCall(name=TOOL_NAME))]),
    )
    asyncio.run(guard(SimpleNamespace(state={}), call))
    assert call.content.parts[0].function_call is not None
    chunk = _final("partial text")
    chunk.partial = True
    asyncio.run(guard(SimpleNamespace(state={}), chunk))
    assert chunk.content.parts[0].text == "partial text"


def test_one_illustration_never_inherits_anothers_state():
    """AgentTool copies the tutor's state into each run: unscoped, the second
    diagram of a turn would start at the attempt cap or be handed the first."""
    first, second = SimpleNamespace(state={}, invocation_id="i1"), SimpleNamespace(invocation_id="i2")
    asyncio.run(render_svg_preview(GOOD, tool_context=first))
    second.state = dict(first.state)  # what AgentTool does
    response = _final("anything")
    asyncio.run(make_final_svg_guard()(second, response))
    assert response.content.parts[0].text == NO_DIAGRAM
    assert scoped(LAST_GOOD_KEY, first) in second.state


def test_only_an_agent_holding_the_drawing_tools_is_guarded():
    """The tutor receives the illustrator's state deltas; if the guard ran on
    the tutor it would replace the tutor's own reply with a diagram."""
    from adk.agent import create_agent
    from auth.firebase_auth import User
    from db.models import SkillConfig, SkillMetadata

    def _agent(tools):
        cfg = SkillConfig(
            name="s", description="d", instructions="i", skillId="s-id", skillMetadata=SkillMetadata(tools=tools)
        )
        return create_agent(cfg, User(uid="u", email="a@b.c", domain="b.c"))

    state = {}
    ctx = SimpleNamespace(state=state)
    asyncio.run(render_svg_preview(GOOD, tool_context=ctx))
    tutor_reply = _final("Se tegningen. Hvad viser pilene?")
    asyncio.run(_agent([]).after_model_callback(ctx, tutor_reply))
    assert tutor_reply.content.parts[0].text.startswith("Se tegningen")
    drawer_reply = _final("done")
    asyncio.run(_agent(["render_svg_preview"]).after_model_callback(ctx, drawer_reply))
    assert drawer_reply.content.parts[0].text == f"```svg\n{GOOD}\n```"
