"""1.1.149 M1 — the ONE "is this a referral to the workbench?" answer.

The runtime nudge, the bench probe and the prod SQL must count the same thing;
these pin the lexicon, the activity names, the ``control_sim`` rule and the
SQL mirror.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path

import pytest

from analytics.workbench_referral import (
    GENERIC_PATTERN,
    is_referral,
    make_vocabulary,
    referral_probe,
    referral_vocabulary,
    sim_names,
)
from db.models.activity_config import ActivityConfig, ChecklistItem, TableColumn, TableElement

_REPO = Path(__file__).resolve().parents[3]
_SQL = _REPO / "research" / "workbench-referral" / "m0.sql"


def _cfg(**kw) -> ActivityConfig:
    base = {"activityId": "act-1", "classId": "c", "teacherUid": "t", "updatedAt": datetime.now(UTC)}
    base.update(kw)
    return ActivityConfig(**base)


@pytest.mark.parametrize(
    "text",
    [
        "Prøv at åbne simuleringen og ændre vinklen — hvad sker der med rækkevidden?",
        "Skriv dine målinger i tabellen, og fortæl mig hvad du ser.",
        "Kig på grafen: hvor er den stejlest?",
        "Brug lommeregneren til at regne effekten ud.",
        "Hvad står der som næste punkt på tjeklisten?",
        "Try the simulation with a steeper angle and tell me what changes.",
        "Fill in the data table first.",
        "Hvad viser elmåleren nu?",
        "Skriv det i skrivefeltet.",
    ],
)
def test_generic_lexicon_hits_in_both_languages(text: str) -> None:
    assert is_referral(text)


@pytest.mark.parametrize(
    "text",
    [
        "Hvad tror du der sker med farten i toppunktet?",
        "Why do you think the period stays the same?",
        "",
        None,
    ],
)
def test_plain_dialogue_is_not_a_referral(text) -> None:
    assert not is_referral(text)


def test_activity_names_count_beside_the_lexicon() -> None:
    cfg = _cfg(
        artefactId="kettle-efficiency",
        table=[TableElement(id="t1", title="Måleskema", columns=[TableColumn(id="a", label="t")], rows=3)],
    )
    vocab = referral_vocabulary(cfg)
    assert "Måleskema" in vocab.names
    # The sim's own names: the head before the dash, and its first word.
    assert "Elkedel" in vocab.names
    assert is_referral("Åbn Måleskema og skriv tiden ind.", vocab)
    assert not is_referral("Åbn Måleskema og skriv tiden ind.")  # no generic word in it


def test_sim_names_skip_words_too_short_to_be_names() -> None:
    assert sim_names("LED Planck — bestem Plancks konstant")[1:] == ["LED Planck"]
    assert "Sol" not in sim_names("Sol, Jord og Måne")
    assert "Boldkast" in sim_names("Boldkast — projektilbevægelse")
    assert sim_names(None) == []


def test_a_control_sim_call_counts_whatever_the_prose_says() -> None:
    assert is_referral("Se her.", function_calls=["control_sim"])
    assert not is_referral("Se her.", function_calls=["mark_checklist_item"])


def test_short_titles_are_not_names() -> None:
    assert make_vocabulary(["A", "T1", "Tab"]).names == ()


def test_the_sql_lexicon_equals_generic_pattern() -> None:
    """The prod count (M0/M6) and the runtime nudge must count the same thing."""
    sql = _SQL.read_text(encoding="utf-8")
    m = re.search(r"DECLARE ref_re STRING DEFAULT r'(.*)';", sql)
    assert m, "m0.sql no longer declares ref_re"
    assert m.group(1) == GENERIC_PATTERN


def test_the_lexicon_compiles_as_one_pattern() -> None:
    assert re.compile(GENERIC_PATTERN)


def test_checklist_has_no_title_and_contributes_no_name() -> None:
    assert referral_vocabulary(_cfg(checklist=[ChecklistItem(id="a", label="Mål tiden")])).names == ()


# --- the probe --------------------------------------------------------------------


def _t(role: str, content: str, calls=None) -> dict:
    d = {"role": role, "content": content}
    if calls:
        d["calls"] = calls
    return d


def test_probe_counts_first_referral_share_and_the_stuck_window() -> None:
    turns = [
        _t("student", "hej"),
        _t("tutor", "Hvad tror du?"),
        _t("student", "ved ikke"),
        _t("tutor", "Åbn simuleringen og prøv 45 grader."),
        _t("student", "jeg ved det ikke"),  # stuck, student turn 2
        _t("tutor", "Hvad tror du?"),
        _t("student", "ok"),
        _t("tutor", "Skriv det i tabellen."),
    ]
    p = referral_probe(turns, stuck_student_turn=2)
    assert (p.tutor_turns, p.referring_turns, p.first_referral_turn) == (4, 2, 2)
    assert p.after_stuck is True
    assert p.share == 0.5


def test_probe_misses_a_referral_outside_the_window() -> None:
    turns = [
        _t("student", "jeg ved det ikke"),
        _t("tutor", "Hvad tror du?"),
        _t("student", "?"),
        _t("tutor", "Hvad tror du?"),
        _t("student", "?"),
        _t("tutor", "Prøv simuleringen."),
    ]
    assert referral_probe(turns, stuck_student_turn=0).after_stuck is False


def test_probe_without_a_stuck_turn_reports_none() -> None:
    p = referral_probe([_t("student", "x"), _t("tutor", "y")])
    assert p.after_stuck is None
    assert p.first_referral_turn is None
