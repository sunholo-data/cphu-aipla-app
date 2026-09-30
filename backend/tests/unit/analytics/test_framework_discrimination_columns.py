"""BENCH-2: the column-normalised metrics and the tone probe.

Why these exist: BENCH-1's diagonal accuracy (argmax across all seven judged
columns) sat at chance because the judge reads the ESRU column high for every
dialogue and the CER column ~0 for every dialogue. Read DOWN a column instead,
where every tutor is measured with the same criteria, and the offset cancels.
The fixture is the first run's raw scores, trimmed to the fields the metrics
read (no rationales), so the reading in the sprint doc is now a test.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from analytics import framework_discrimination as fd
from reports.session_summary import SessionTurn

FIXTURE = Path(__file__).parent / "fixtures" / "bench1_raw_scores_20260930.jsonl"
ORDER = ["5e", "accountable-talk", "authentic-dialogue", "cer", "esru", "poe", "toulmin"]


def _turn(role: str, content: str) -> SessionTurn:
    return SessionTurn(timestamp="2026-09-30T10:00:00+00:00", role=role, content=content)


DIALOGUE = [
    _turn("student", "Tunge ting falder hurtigere."),
    _turn("tutor", "Hvad bygger du det på?"),
    _turn("student", "Det føles sådan."),
    _turn("tutor", "Lad os prøve: slip to kugler med forskellig masse."),
    _turn("student", "De landede samtidig."),
    _turn("tutor", "Hvad betyder det så for din idé?"),
]


def _col_records(table: dict[str, dict[str, float | None]]) -> list[fd.TranscriptFit]:
    return [fd.TranscriptFit(f"t-{prod}", prod, fits) for prod, fits in table.items()]


# A judge with a ceiling column (esru reads 1.0 for everyone) and a real signal
# in poe: argmax says esru wins everything; the columns say poe's tutor does poe.
BIASED = {
    "esru": {"esru": 1.0, "poe": 0.2, "cer": 0.0},
    "poe": {"esru": 1.0, "poe": 0.8, "cer": 0.0},
    "cer": {"esru": 1.0, "poe": 0.2, "cer": 0.1},
}
COLS = ["esru", "poe", "cer"]


def test_argmax_is_defeated_by_a_ceiling_column_and_the_columns_are_not():
    recs = _col_records(BIASED)
    acc, n = fd.diagonal_accuracy(recs)
    # esru is every transcript's argmax: the one "hit" is the esru tutor, credited for the ceiling, and
    # the poe tutor — the only one that actually does its approach — is a miss.
    assert (acc, n) == (pytest.approx(1 / 3), 3)
    ranks = {r.column: r for r in fd.own_column_rank(fd.fit_matrix(recs), COLS)}
    assert ranks["poe"].status == "clear" and ranks["poe"].rank == 1
    assert ranks["cer"].status == "clear"
    assert ranks["esru"].status == "tied" and ranks["esru"].tied_with == ("cer", "poe")
    assert fd.summarise_ranks(ranks.values()).headline() == "2 of 3 clear, 1 tied"


def test_own_column_rank_behind_and_unreadable():
    recs = _col_records({"a": {"a": 0.2, "b": 0.5}, "b": {"a": 0.6, "b": None}})
    ranks = {r.column: r for r in fd.own_column_rank(fd.fit_matrix(recs), ["a", "b"])}
    assert ranks["a"].status == "behind" and ranks["a"].rank == 2 and ranks["a"].best_other_by == ("b",)
    assert ranks["b"].status == "unreadable" and ranks["b"].rank is None
    assert fd.summarise_ranks(ranks.values()).headline() == "0 of 1 clear, 0 tied (1 unreadable)"


def test_z_margin_is_scale_free_and_none_on_a_flat_column():
    matrix = fd.fit_matrix(_col_records(BIASED))
    zs = fd.column_z_margins(matrix, COLS)
    assert zs["esru"] is None  # every tutor 1.0: no z exists
    # poe (0.2/0.8/0.2) and cer (0/0/0.1) have the same SHAPE, so the same z-margin ...
    assert zs["poe"] == pytest.approx(zs["cer"]) and zs["poe"] > 0
    # ... and the raw margin says how big each actually is.
    raw = fd.column_raw_margins(matrix, COLS)
    assert raw["poe"] == pytest.approx(0.6) and raw["cer"] == pytest.approx(0.1) and raw["esru"] == 0
    mean, n = fd.mean_z_margin(matrix, COLS)
    assert n == 2 and mean == pytest.approx(zs["poe"])


def test_column_bias_flags_ceiling_floor_and_low_spread():
    bias = {b.column: b for b in fd.column_bias(fd.fit_matrix(_col_records(BIASED)), COLS)}
    assert bias["esru"].flags == ("low-spread", "ceiling") and bias["esru"].spread == 0
    assert bias["cer"].flags == ("floor",)  # spread 0.10 is not under 0.10
    assert bias["poe"].flags == () and bias["poe"].spread == pytest.approx(0.6)


def _fixture_records(model: str) -> list[fd.TranscriptFit]:
    rows = [json.loads(line) for line in FIXTURE.read_text(encoding="utf-8").splitlines()]
    return [
        fd.TranscriptFit(r["id"], r["producing"], {k: v["fit"] for k, v in r["fit"]["fits"].items()})
        for r in rows
        if r["tutorModel"] == model and r["ok"]
    ]


def test_bench1_first_run_under_the_column_metrics():
    """Argmax at chance; read down the columns, 3.8-flash's own tutor is top in
    3 columns clear and 2 tied — the reading the sprint doc made by hand."""
    big = _fixture_records("gemini-3.8-flash")
    lite = _fixture_records("gemini-3.5-flash-lite")
    assert len(big) == 21 and len(lite) == 19  # two flash-lite transcripts failed

    h = fd.column_headline(big, ORDER)
    assert h.diagonal == pytest.approx(3 / 21)  # 0.14 = chance
    assert h.ranks.headline() == "3 of 7 clear, 2 tied"
    ranks = {r.column: r for r in fd.own_column_rank(fd.fit_matrix(big), ORDER)}
    assert {c for c, r in ranks.items() if r.status == "clear"} == {"authentic-dialogue", "cer", "poe"}
    assert {c for c, r in ranks.items() if r.status == "tied"} == {"5e", "esru"}
    assert ranks["poe"].own == pytest.approx(0.556, abs=1e-3)
    assert ranks["poe"].best_other == pytest.approx(0.278, abs=1e-3)
    assert h.z_margin is not None and h.z_margin > 1

    hl = fd.column_headline(lite, ORDER)
    assert hl.ranks.headline() == "2 of 7 clear, 0 tied"
    # ESRU (ceiling) and CER (floor) are the columns that cannot discriminate on flash-lite.
    assert {b.column for b in hl.flagged} == {"cer", "esru"}
    bias = {b.column: b for b in fd.column_bias(fd.fit_matrix(lite), ORDER)}
    assert "ceiling" in bias["esru"].flags and "floor" in bias["cer"].flags


def test_the_model_section_leads_with_the_columns_and_labels_argmax_strict():
    text = fd.render_model_section("m", _fixture_records("gemini-3.8-flash"), ORDER, [], 0, None)
    assert text.index("Own-column rank") < text.index("Strict argmax")
    assert "| poe | 0.56 |" in text and "clear (#1 of 7)" in text
    assert "Not assessed in this run" in text  # missing tone data is said, not shown as an empty table


# ── the tone probe ───────────────────────────────────────────────────────────


async def test_tone_is_blind_judged_and_cites_tutor_turns_only():
    prompts: list[str] = []

    async def judge(prompt: str, model: str) -> str:
        prompts.append(prompt)
        return json.dumps(
            {
                "grade": "marked",
                "instances": [
                    {"turn": 1, "quote": "Fantastisk spørgsmål!", "why": "stock"},
                    {"turn": 2, "quote": "Flot!", "why": "a STUDENT turn — must be dropped"},
                ],
                "rationale": "r",
            }
        )

    out = await fd.score_tone(DIALOGUE, model="gemini-3.8-flash", judge=judge)
    assert out["calls"] == 1 and not out["abstained"]
    assert out["grade"] == "marked" and out["score"] == 2 and out["evidence"] == [1]
    assert out["promptVersion"] == fd.TONE_PROMPT_VERSION
    p = prompts[0]
    assert "[1] TUTOR: Hvad bygger du det på?" in p
    for leak in ("esru", "ESRU", "Teaching approach", "The wrong claim", "correct physics"):
        assert leak not in p


def test_an_uncited_tone_grade_is_downgraded_to_none():
    out = fd.parse_tone('{"grade": "mild", "instances": [], "rationale": "r"}', [1, 3])
    assert out["grade"] == "none" and out["uncitedDowngrade"] is True
    with pytest.raises(ValueError):
        fd.parse_tone('{"grade": "gushing"}', [1])


async def test_tone_on_too_little_dialogue_abstains_without_a_call():
    async def judge(prompt: str, model: str) -> str:  # pragma: no cover - must not run
        raise AssertionError("called")

    out = await fd.score_tone(DIALOGUE[:2], model="gemini-3.8-flash", judge=judge)
    assert out["abstained"] and out["calls"] == 0


async def test_a_judge_failure_abstains_with_status_and_message():
    class Boom(Exception):
        code = 400
        message = "Request contains an invalid argument."

    async def judge(prompt: str, model: str) -> str:
        raise Boom()

    out = await fd.score_tone(DIALOGUE, model="gemini-3.8-flash", judge=judge)
    assert out["abstained"] and "Boom 400: Request contains an invalid argument." in out["abstainReason"]


def test_tone_table_aggregates_per_approach():
    rows = [
        {"producing": "esru", "scenario": "s1", "grade": "none", "instances": []},
        {"producing": "esru", "scenario": "s2", "grade": "marked", "instances": [{"turn": 3, "quote": "Flot!"}]},
        {"producing": "esru", "scenario": "s3", "abstained": True},
    ]
    (row,) = fd.tone_table(rows, ["esru"])
    assert (row.none, row.mild, row.marked, row.abstained) == (1, 0, 1, 1)
    assert row.mean_score == 1.0 and row.example == "s2 [3] “Flot!”"
