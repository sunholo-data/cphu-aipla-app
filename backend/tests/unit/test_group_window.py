"""1.1.163 M0/M1 — what one group did in a window, counted from the sink rows.

Rows shaped like the prod sink tables (checked 2026-11-26 against
green-beetle-49, 09:40-09:50: 3 questions, 5 feedback requests, 8 tutor turns,
3 handouts opened, Undervejs 42 → 85 words, no sim pushes).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from analytics.group_window import build_window

T0 = datetime(2026, 11, 25, 9, 40, tzinfo=UTC)
T1 = T0 + timedelta(minutes=10)
FB = "Kan du give mig feedback på {title}? Her er hvad jeg har skrevet:\n\n{text}"


def _at(minute: float) -> datetime:
    return T0 + timedelta(minutes=minute)


def _sheet(*docs: tuple[str, str, str]) -> str:
    return json.dumps(
        {"docs": [{"id": i, "title": t, "text": x, "words": len(x.split()), "truncated": False} for i, t, x in docs]}
    )


def test_counts_questions_feedback_and_tutor_tools_inside_the_window_only():
    turns = [
        {"ts": _at(-5), "role": "student", "content": "before the window", "tools_called": ""},
        {"ts": _at(1), "role": "student", "content": "[session_start]", "tools_called": ""},
        {"ts": _at(2), "role": "student", "content": FB.format(title="Undervejs", text="Li+"), "tools_called": ""},
        {"ts": _at(3), "role": "tutor", "content": "Fint.", "tools_called": "calculate,calculate"},
        {"ts": _at(4), "role": "student", "content": "hvor mange sek er det", "tools_called": None},
        {"ts": _at(5), "role": "tutor", "content": "3600 s.", "tools_called": "show_calculation"},
    ]
    w = build_window("g", T0, T1, turns, [])
    assert (w.questions, w.feedback_requests, w.tutor_turns) == (1, 1, 2)
    assert w.tools == {"calculate": 2, "show_calculation": 1}
    assert w.last_activity_at == _at(5)
    assert not w.empty


def test_words_written_compare_the_last_snapshot_before_with_the_last_inside():
    wb = [
        {"ts": _at(-30), "server": "writing", "tool": "state", "value": _sheet(("w1", "Del 1", "a b"))},
        {
            "ts": _at(-2),
            "server": "writing",
            "tool": "state",
            "value": _sheet(("w1", "Del 1", "a b c"), ("w2", "Afslutning", "x")),
        },
        {
            "ts": _at(3),
            "server": "writing",
            "tool": "state",
            "value": _sheet(("w1", "Del 1", "a b c d e"), ("w2", "Afslutning", "x")),
        },
        {
            "ts": _at(6),
            "server": "writing",
            "tool": "state",
            "value": _sheet(("w1", "Del 1", "a b c d e f"), ("w2", "Afslutning", "x"), ("w3", "Ny", "y z")),
        },
    ]
    w = build_window("g", T0, T1, [], wb)
    changed = {s.title: (s.words_before, s.words_now) for s in w.sheets}
    assert changed == {"Del 1": (3, 6), "Ny": (0, 2)}  # Afslutning unchanged → not listed


def test_sims_tables_and_documents_are_counted_and_the_tutors_own_moves_are_not():
    wb = [
        {"ts": _at(1), "server": "li-ion-batteri", "tool": "state", "value": "{}"},
        {"ts": _at(2), "server": "li-ion-batteri", "tool": "state", "value": "{}"},
        {"ts": _at(2), "server": "sol-jord-maane", "tool": "control_sim", "value": "{}"},
        {"ts": _at(3), "server": "table", "tool": "state", "value": "{}"},
        {"ts": _at(4), "server": "documents", "tool": "document.open", "value": ""},
        {"ts": _at(5), "server": "progress", "tool": "record_assessment", "value": "{}"},
        {"ts": _at(-1), "server": "li-ion-batteri", "tool": "state", "value": "{}"},
    ]
    w = build_window("g", T0, T1, [], wb)
    assert [(s.server, s.changes) for s in w.sims] == [("li-ion-batteri", 2)]
    assert (w.table_edits, w.documents_opened) == (1, 1)


def test_a_quiet_window_is_empty():
    w = build_window("g", T0, T1, [{"ts": _at(-3), "role": "student", "content": "hej", "tools_called": ""}], [])
    assert w.empty and w.last_activity_at is None


def test_an_unreadable_writing_push_is_skipped_not_fatal():
    wb = [{"ts": _at(1), "server": "writing", "tool": "state", "value": "not json"}]
    assert build_window("g", T0, T1, [], wb).sheets == []
