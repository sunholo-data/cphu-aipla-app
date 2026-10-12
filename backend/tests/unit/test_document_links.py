"""1.1.147 M3c — the tutor links shared documents, and only shared documents.

The prompt gives the model the student-visible docIds; the guard on the way out
reduces any other ``aitana://doc`` link to plain text, on every streamed chunk
and in the stored response.
"""

from __future__ import annotations

import itertools
import re
from types import SimpleNamespace

import pytest

from adk.document_links import (
    DocLinkStreamFilter,
    build_document_links_block,
    make_document_link_guard,
    shared_document_ids,
    strip_unshared_doc_links,
)
from db.models.activity_config import ActivityConfig, MaterialRef

SHARED = "doc-shared-11"
SECRET = "doc-secret-77"
ALLOWED = frozenset({SHARED})


def _cfg(materials: list[MaterialRef]) -> ActivityConfig:
    return ActivityConfig(
        activityId="act-m3c",
        teacherUid="t1",
        classId="c1",
        teachingGoal="g",
        materials=materials,
        updatedAt="2026-10-08T00:00:00Z",
    )


def _mat(doc_id: str, *, visible: bool, kind: str = "curriculum", title: str = "") -> MaterialRef:
    return MaterialRef(kind=kind, docId=doc_id, title=title, studentVisible=visible)


@pytest.mark.parametrize(
    ("raw", "clean"),
    [
        # A shared document stays a link.
        (f"Se [Læreplanen](aitana://doc/{SHARED}/block/0).", f"Se [Læreplanen](aitana://doc/{SHARED}/block/0)."),
        # A not-shared one becomes its label.
        (f"Se [Prompten](aitana://doc/{SECRET}/block/0).", "Se Prompten."),
        (f'Se [Prompten](<aitana://doc/{SECRET}/block/3> "titel").', "Se Prompten."),
        (f"Se [Fysik [C]](aitana://doc/{SECRET}/block/0) nu", "Se Fysik [C] nu"),
        # Bare and autolinked URLs to a not-shared doc are removed.
        (f"Kilde: aitana://doc/{SECRET}/block/0 slut", "Kilde:  slut"),
        (f"Kilde: <aitana://doc/{SECRET}/block/0>", "Kilde: "),
        # ...without eating the sentence's full stop.
        (f"Se aitana://doc/{SECRET}/block/0.", "Se ."),
        # Case does not smuggle one through.
        (f"[x](AITANA://doc/{SECRET}/block/0)", "x"),
        # Not a document, or a malformed path: not a link a student is given.
        ("[x](aitana://admin/whatever)", "x"),
        (f"[x](aitana://doc/{SHARED}/elsewhere/0)", "x"),
        # A reference definition loses its target.
        (f"[1]: aitana://doc/{SECRET}/block/0", "[1]: "),
        # Ordinary links and brackets are untouched.
        ("Se [UVM](https://uvm.dk) og intervallet [0, 1].", "Se [UVM](https://uvm.dk) og intervallet [0, 1]."),
    ],
)
def test_strip_unshared_doc_links(raw, clean):
    assert strip_unshared_doc_links(raw, ALLOWED) == clean


REPLY = (
    f"Læs afsnittet i [Vejledning til Fysik C](aitana://doc/{SHARED}/block/0), "
    f"ikke [lærerens prompt](aitana://doc/{SECRET}/block/0). "
    f"Eller aitana://doc/{SECRET}/block/2 — og data i intervallet [0, 1) giver mening."
)
EXPECTED = strip_unshared_doc_links(REPLY, ALLOWED)


def test_the_expected_reply_keeps_the_shared_link_and_drops_the_secret():
    assert f"aitana://doc/{SHARED}/block/0" in EXPECTED
    assert SECRET not in EXPECTED
    assert "lærerens prompt" in EXPECTED


def _chunkings():
    # Every two-way split, plus a few character-level ones around the links.
    for i in range(1, len(REPLY)):
        yield [REPLY[:i], REPLY[i:]]
    for size in (1, 2, 3, 7, 13):
        yield [REPLY[k : k + size] for k in range(0, len(REPLY), size)]


@pytest.mark.parametrize("chunks", list(_chunkings()))
def test_stream_never_emits_the_secret_however_the_reply_is_split(chunks):
    f = DocLinkStreamFilter(ALLOWED)
    emitted = [f.feed(c) for c in chunks]
    out = "".join(emitted) + f.flush()
    assert out == EXPECTED
    # Not only the joined text: no single emitted piece may carry it either.
    assert all(SECRET not in piece for piece in emitted)


def test_a_word_ending_like_the_scheme_is_not_held():
    f = DocLinkStreamFilter(ALLOWED)
    assert f.feed("Se på data") == "Se på data"
    assert f.feed(" og en a") == " og en "  # "a" may start "aitana://": held one chunk
    assert f.feed("lmindelig") == "almindelig"


def test_an_unclosed_bracket_far_back_is_released():
    f = DocLinkStreamFilter(ALLOWED)
    text = "Intervallet [0, 1) " + "og så videre " * 40
    assert f.feed(text) == text


# --- the after-model callback -------------------------------------------------


def _part(text: str, thought: bool = False):
    return SimpleNamespace(text=text, thought=thought)


def _resp(*parts, partial: bool, finish_reason=None):
    return SimpleNamespace(content=SimpleNamespace(parts=list(parts)), partial=partial, finish_reason=finish_reason)


@pytest.mark.asyncio
async def test_callback_rewrites_streamed_chunks_releases_on_finish_and_strips_the_final():
    cb = make_document_link_guard(ALLOWED)
    ctx = SimpleNamespace(invocation_id="inv-1")
    pieces = [REPLY[:40], REPLY[40:95], REPLY[95:]]
    streamed = []
    for i, piece in enumerate(pieces):
        r = _resp(_part(piece), partial=True, finish_reason="STOP" if i == len(pieces) - 1 else None)
        await cb(ctx, r)
        streamed.append(r.content.parts[0].text)
    assert "".join(streamed) == EXPECTED  # nothing lost at the end of the live stream

    final = _resp(_part(REPLY), partial=False, finish_reason="STOP")
    await cb(ctx, final)
    assert final.content.parts[0].text == EXPECTED


@pytest.mark.asyncio
async def test_callback_releases_a_held_tail_on_a_text_free_finish_chunk():
    cb = make_document_link_guard(ALLOWED)
    ctx = SimpleNamespace(invocation_id="inv-2")
    first = _resp(_part("Se ["), partial=True)
    await cb(ctx, first)
    assert first.content.parts[0].text == "Se "
    last = SimpleNamespace(content=None, partial=True, finish_reason="STOP")
    await cb(ctx, last)
    assert last.content.parts[0].text == "["


@pytest.mark.asyncio
async def test_callback_leaves_thoughts_alone():
    cb = make_document_link_guard(ALLOWED)
    r = _resp(_part(f"aitana://doc/{SECRET}/block/0", thought=True), partial=False)
    await cb(SimpleNamespace(invocation_id="x"), r)
    assert SECRET in r.content.parts[0].text


# --- the prompt block ---------------------------------------------------------


def test_only_student_visible_reader_materials_are_linkable():
    mats = [
        _mat(SHARED, visible=True, title="Vejledning til Fysik C"),
        _mat(SECRET, visible=False, title="Prompt for Energi"),
        _mat("doc-context-5", visible=True, kind="context", title="Opgaveark"),
        MaterialRef(kind="image", materialId="img-1", studentVisible=True),
    ]
    assert shared_document_ids(mats) == {SHARED, "doc-context-5"}


def test_the_block_gives_the_shared_ids_and_never_a_secret_one():
    cfg = _cfg(
        [
            _mat(SHARED, visible=True, title="Vejledning [Fysik C]"),
            _mat(SECRET, visible=False, title="Prompt for Energi"),
        ],
    )
    block = build_document_links_block(cfg)
    assert f"(aitana://doc/{SHARED}/block/0)" in block
    assert "[Vejledning (Fysik C)]" in block  # a bracket in a title cannot break the link
    assert SECRET not in block
    assert "Prompt for Energi" not in block
    assert "Never write an aitana:// link to any other document" in block


@pytest.mark.parametrize(
    "materials",
    [[], [_mat(SECRET, visible=False)], [MaterialRef(kind="image", materialId="i", studentVisible=True)]],
)
def test_no_block_when_nothing_is_shared(materials):
    cfg = _cfg(materials)
    assert build_document_links_block(cfg) == ""
    assert build_document_links_block(None) == ""


def test_every_link_in_the_block_survives_the_guard():
    """The prompt and the guard must agree: a link the prompt teaches the model
    to write is one the guard lets through."""
    cfg = _cfg([_mat(SHARED, visible=True, title="T")])
    block = build_document_links_block(cfg)
    links = re.findall(r"\[[^\]]*\]\(aitana://[^)]*\)", block)
    assert links
    for link in links:
        assert strip_unshared_doc_links(link, shared_document_ids(cfg.materials)) == link


def test_chunkings_cover_both_links():
    # Sanity: the split set includes splits inside each link target.
    idx = REPLY.index(SECRET)
    assert any(len(c) == 2 and len(c[0]) == idx + 3 for c in itertools.islice(_chunkings(), len(REPLY)))
