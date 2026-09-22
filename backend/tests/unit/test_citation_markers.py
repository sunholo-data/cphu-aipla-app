"""1.1.122 — Vertex's ``[rag-source-N]`` labels never reach a student.

Real examples from prod, 2026-09-22 (13% of tutor turns that day).
"""

from __future__ import annotations

import re
from types import SimpleNamespace

import pytest

from adk.citation_markers import MarkerStreamFilter, make_marker_strip_callback, strip_markers

LEAK = re.compile(r"\[rag-source-\d+\]")


@pytest.mark.parametrize(
    ("raw", "clean"),
    [
        (
            "Vi undersøger bølgelængde og svingningstid på en spilleplade med 14 felter [rag-source-1].",
            "Vi undersøger bølgelængde og svingningstid på en spilleplade med 14 felter.",
        ),
        (
            "Bølgehastigheden $v$ er konstant [rag-source-1], og $\\lambda = v \\cdot T$ [rag-source-3].",
            "Bølgehastigheden $v$ er konstant, og $\\lambda = v \\cdot T$.",
        ),
        ("Ingen kilder her.", "Ingen kilder her."),
        # Look-alikes that are not markers are left alone.
        (
            "Se [kilde] og [1] og [rag-source] og [rag-source-x].",
            "Se [kilde] og [1] og [rag-source] og [rag-source-x].",
        ),
    ],
)
def test_strip_markers(raw, clean):
    assert strip_markers(raw) == clean


def _stream(chunks: list[str]) -> str:
    f = MarkerStreamFilter()
    return "".join(f.feed(c) for c in chunks) + f.flush()


@pytest.mark.parametrize(
    "chunks",
    [
        ["positiv effekt [rag-source-1]. Næste sætning."],
        ["positiv effekt [rag-", "source-1]. Næste sætning."],
        ["positiv effekt [", "rag-source-", "1", "]. Næste sætning."],
        ["positiv effekt ", "[rag-source-12", "]. Næste sætning."],
    ],
)
def test_marker_split_across_chunks_is_stripped(chunks):
    assert _stream(chunks) == "positiv effekt. Næste sætning."


def test_held_fragment_that_is_not_a_marker_is_released():
    assert _stream(["en liste [r", "eel] tal"]) == "en liste [reel] tal"
    assert _stream(["slutter med ["]) == "slutter med ["


def _resp(text: str, *, partial: bool, thought: bool = False):
    part = SimpleNamespace(text=text, thought=thought)
    return SimpleNamespace(content=SimpleNamespace(parts=[part]), partial=partial)


async def test_callback_strips_streamed_chunks_and_the_final_response():
    cb = make_marker_strip_callback()
    ctx = SimpleNamespace(invocation_id="inv-1")
    streamed = []
    for chunk in ["Kruse (2013) konkluderer en positiv effekt [rag-", "source-1]. Hvad tænker I?"]:
        r = _resp(chunk, partial=True)
        await cb(ctx, r)
        streamed.append(r.content.parts[0].text)
    final = _resp("Kruse (2013) konkluderer en positiv effekt [rag-source-1]. Hvad tænker I?", partial=False)
    await cb(ctx, final)

    assert not LEAK.search("".join(streamed))
    assert "".join(streamed) == "Kruse (2013) konkluderer en positiv effekt. Hvad tænker I?"
    # The final response is what the session store and the chat log keep.
    assert final.content.parts[0].text == "Kruse (2013) konkluderer en positiv effekt. Hvad tænker I?"


async def test_callback_ignores_non_text_and_thought_parts():
    cb = make_marker_strip_callback()
    ctx = SimpleNamespace(invocation_id="inv-2")
    thought = _resp("thinking about [rag-source-1]", partial=False, thought=True)
    await cb(ctx, thought)
    assert thought.content.parts[0].text == "thinking about [rag-source-1]"
    await cb(ctx, SimpleNamespace(content=None, partial=False))  # no crash
