"""1.1.140 M3: the BENCH harness on REAL sessions (--from-sessions), with a
mocked BigQuery and a mocked judge.

The properties that matter: only real teaching is selected (no preview, no
persona-field turns, no teacher/preview groups); turns come back in order with
the right roles; group ids never leave except as a salted hash (ADR-001); a dry
run makes zero model calls and reads no transcript; the headline is computed.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from datetime import date
from pathlib import Path

import pytest

from analytics import session_discrimination as sd
from analytics.framework_fidelity import criteria_block
from analytics.research_logs import NON_STUDENT_PREFIXES
from frameworks.loader import ready_frameworks

SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "bench-tutor-discrimination.py"

# Group codes that must never appear in any output.
GROUPS = {"esru": ["fys-a-1", "fys-a-2", "fys-a-3"], "poe": ["fys-b-1", "fys-b-2", "fys-b-3"]}


@pytest.fixture(scope="module")
def bench():
    spec = importlib.util.spec_from_file_location("bench_tutor_discrimination_sessions", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def env(monkeypatch):
    # from_sessions sets these; keep them test-scoped.
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "unset")
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "global")


@pytest.fixture
def no_model_calls(monkeypatch):
    import google.genai as genai

    def _boom(*a, **kw):
        raise AssertionError("a model client was constructed")

    async def _judge_boom(*a, **kw):
        raise AssertionError("the judge was called")

    monkeypatch.setattr(genai, "Client", _boom)
    monkeypatch.setattr("analytics.session_rubric._call_judge_model", _judge_boom)


def _summary_rows():
    rows = []
    for fw, groups in GROUPS.items():
        for i, g in enumerate(groups):
            rows.append(
                {
                    "session_id": f"s-{fw}-{i}",
                    "group_ids": [g],
                    "framework_ids": [fw],
                    "tutor_ids": ["mikkel" if fw == "esru" else "sofie"],
                    "persona_ids": [],
                    "models": ["gemini-3.5-flash-lite"],
                    "tutor_turns": 6,
                    "student_turns": 7,
                    "chars": 2000,
                    "first_ts": f"2026-09-2{6 + i}T09:00:00+00:00",
                }
            )
    # Reassigned mid-session: excluded, counted.
    rows.append({**rows[0], "session_id": "s-mixed", "framework_ids": ["esru", "poe"]})
    # Too short: excluded, counted.
    rows.append({**rows[0], "session_id": "s-short", "tutor_turns": 3})
    return rows


def _transcript_rows(session_ids):
    out = []
    for sid in session_ids:
        fw = sid.split("-")[1]
        turns = [("student", "[session_start]")]
        for k in range(6):
            turns += [("tutor", f"MARK-{fw} tutor turn {k}"), ("student", f"elev svar {k}")]
        # Deliberately shuffled, with turn_index carrying the order.
        indexed = list(enumerate(turns))
        for idx, (role, content) in reversed(indexed):
            out.append(
                {
                    "session_id": sid,
                    "ts": f"2026-09-26T09:{idx:02d}:00+00:00",
                    "turn_index": idx,
                    "role": role,
                    "content": content,
                }
            )
    return out


class FakeBQ:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    def __call__(self, sql, params):
        self.calls.append((sql, params))
        if "GROUP BY teaching_source" in sql:
            return [
                {"teaching_source": "tutor", "sessions": 8},
                {"teaching_source": "preview", "sessions": 4},
                {"teaching_source": "fields", "sessions": 2},
            ]
        if "UNNEST(@session_ids)" in sql:
            return _transcript_rows(params["session_ids"])
        if "GROUP BY session_id" in sql:
            return _summary_rows()
        raise AssertionError(f"unexpected query: {sql}")


# --- selection ---------------------------------------------------------------------


def test_selection_sql_keeps_only_tutor_teaching_by_student_groups():
    for sql in (sd.selection_sql("`v`"), sd.transcript_sql("`v`")):
        assert "teaching_source = 'tutor'" in sql
        assert "framework_id IS NOT NULL" in sql
        for prefix in NON_STUDENT_PREFIXES:
            assert f"NOT STARTS_WITH(IFNULL(group_id, ''), '{prefix}')" in sql
    assert "preview:" in NON_STUDENT_PREFIXES and "preview-" in NON_STUDENT_PREFIXES
    # The source breakdown is unfiltered on source, so the report can SHOW what was left out.
    assert "teaching_source = 'tutor'" not in sd.excluded_sources_sql("`v`")
    # Nothing but reads.
    for sql in (sd.selection_sql("`v`"), sd.transcript_sql("`v`"), sd.excluded_sources_sql("`v`")):
        assert not any(w in sql.upper() for w in ("INSERT", "UPDATE ", "DELETE", "MERGE", "CREATE"))


def test_select_sessions_excludes_mixed_and_short_and_applies_filters():
    bq = FakeBQ()
    sel = sd.select_sessions(bq, "`v`", since=date(2026, 9, 26), until=date(2026, 9, 30))
    assert {s.session_id for s in sel.sessions} == {f"s-{f}-{i}" for f in GROUPS for i in range(3)}
    assert sel.mixed_framework == 1 and sel.below_min_turns == 1
    assert sel.sources == {"tutor": 8, "preview": 4, "fields": 2}
    # until is inclusive
    assert bq.calls[0][1]["until"].day == 1 and bq.calls[0][1]["until"].month == 10

    only = sd.select_sessions(FakeBQ(), "`v`", since=date(2026, 9, 26), until=date(2026, 9, 30), tutors=["sofie"])
    assert {s.framework_id for s in only.sessions} == {"poe"} and only.filtered_out == 3
    capped = sd.select_sessions(FakeBQ(), "`v`", since=date(2026, 9, 26), until=date(2026, 9, 30), max_sessions=2)
    assert len(capped.sessions) == 2 and capped.capped == 4


def test_turns_come_back_ordered_with_roles_and_no_system_sentinel():
    turns = sd.rows_to_turns(_transcript_rows(["s-esru-0"]))["s-esru-0"]
    assert [t.role for t in turns[:3]] == ["tutor", "student", "tutor"]
    assert turns[0].content == "MARK-esru tutor turn 0"
    assert all(t.content != "[session_start]" for t in turns)
    assert sum(t.role == "tutor" for t in turns) == 6


def test_group_hash_is_salted_and_stable():
    assert sd.group_hash("fys-a-1", "salt") == sd.group_hash("fys-a-1", "salt")
    assert sd.group_hash("fys-a-1", "salt") != sd.group_hash("fys-a-1", "other")
    assert sd.group_hash("fys-a-1", "salt") != sd.group_hash("fys-a-2", "salt")
    assert "fys" not in sd.group_hash("fys-a-1", "salt")


def test_row_n_flags_small_cells_on_sessions_or_groups():
    sel = sd.select_sessions(FakeBQ(), "`v`", since=date(2026, 9, 26), until=date(2026, 9, 30))
    by = {r.framework_id: r for r in sd.row_n(sel.sessions, ["esru", "poe", "cer"])}
    assert by["esru"].sessions == 3 and by["esru"].groups == 3 and by["esru"].small_n
    assert by["cer"].sessions == 0
    hist = dict(sd.turns_histogram(sel.sessions, 6))
    assert hist["6-9"] == 6


# --- the script ----------------------------------------------------------------------


def test_dry_run_makes_no_model_calls_and_reads_no_transcript(bench, env, no_model_calls, capsys):
    bq = FakeBQ()

    async def judge(*a, **kw):
        raise AssertionError("judge called")

    rc = bench.main(
        ["--from-sessions", "--dry-run", "--since", "2026-09-26", "--until", "2026-09-30"], query=bq, judge=judge
    )
    out = capsys.readouterr().out
    assert rc == 0
    assert not any("UNNEST(@session_ids)" in sql for sql, _ in bq.calls)
    n_fw = sum(1 for f in ready_frameworks() if criteria_block(f)[1])
    assert f"fit calls     : {6 * n_fw}" in out and "tone calls: 6" in out
    assert "no model was called" in out and "sessions      : 6 in 6 groups" in out
    assert "aipla-prod-2026" in out  # prod by default
    for groups in GROUPS.values():
        for g in groups:
            assert g not in out


def test_without_go_it_refuses(bench, env, no_model_calls, capsys):
    rc = bench.main(["--from-sessions", "--since", "2026-09-26"], query=FakeBQ())
    assert rc == 2 and "Refusing to call any model without --go" in capsys.readouterr().out


def test_a_mocked_go_run_is_blind_hashes_groups_and_computes_the_headline(bench, env, no_model_calls, tmp_path):
    fws = ready_frameworks()
    prompts: list[str] = []

    async def judge(prompt, model):
        prompts.append(prompt)
        if "whether the TUTOR's praise is earned" in prompt:
            return json.dumps({"grade": "none", "instances": []})
        fw = next(f for f in fws if f"# Teaching approach: {f.label}" in prompt)
        keys = criteria_block(fw)[1]
        band = "strong" if f"MARK-{fw.id} " in prompt else "partial"
        return json.dumps(
            {
                "constructs": {k: {"band": band, "rationale": "", "moves": [f"{k}.1"], "evidence": [0]} for k in keys},
                "overall": {"band": band, "summary": "", "drift": []},
            }
        )

    rc = bench.main(
        ["--from-sessions", "--go", "--since", "2026-09-26", "--until", "2026-09-30", "--out", str(tmp_path)],
        query=FakeBQ(),
        judge=judge,
    )
    assert rc == 0
    # Blind: no tutor id or assigned-framework label beyond the dialogue itself reaches a prompt.
    assert prompts and all("mikkel" not in p and "sofie" not in p for p in prompts)

    report = (tmp_path / "report.md").read_text()
    assert "top of its own column 2 of 2 clear, 0 tied" in report
    assert "What is different from the preview benchmark" in report
    assert "**small n**" in report
    # report.md carries no transcript text.
    assert "MARK-" not in report and "elev svar" not in report

    everything = "".join(p.read_text() for p in tmp_path.iterdir())
    for groups in GROUPS.values():
        for g in groups:
            assert g not in everything  # ADR-001: never the group id, anywhere

    scores = [json.loads(line) for line in (tmp_path / "raw_scores.jsonl").read_text().splitlines()]
    assert len(scores) == 6
    assert all(s["sessionId"] and s["frameworkId"] in GROUPS and len(s["groupHash"]) == 12 for s in scores)
    assert all("groupId" not in s for s in scores)
    assert len({s["groupHash"] for s in scores}) == 6
    transcripts = [json.loads(line) for line in (tmp_path / "transcripts.jsonl").read_text().splitlines()]
    assert all(t["turns"][0]["role"] == "tutor" for t in transcripts)


# --- --include-teacher-trials ------------------------------------------------------------

TRIAL_GROUP = "preview-k7q2xz"  # a teacher's Try-as-student group: must never appear either


class TrialBQ(FakeBQ):
    """Like FakeBQ, but a Try-as-student session exists — and is returned only
    when the SQL actually lets ``preview-`` through, so the flag's wiring is tested."""

    def __call__(self, sql, params):
        rows = super().__call__(sql, params)
        if "GROUP BY session_id" in sql and "'preview-'" not in sql:
            rows = [
                *rows,
                {**_summary_rows()[0], "session_id": "s-esru-trial", "group_ids": [TRIAL_GROUP], "tutor_turns": 8},
            ]
        return rows


def _fake_judge(prompts):
    fws = ready_frameworks()

    async def judge(prompt, model):
        prompts.append(prompt)
        if "whether the TUTOR's praise is earned" in prompt:
            return json.dumps({"grade": "none", "instances": []})
        fw = next(f for f in fws if f"# Teaching approach: {f.label}" in prompt)
        keys = criteria_block(fw)[1]
        band = "strong" if f"MARK-{fw.id} " in prompt else "partial"
        return json.dumps(
            {
                "constructs": {k: {"band": band, "rationale": "", "moves": [f"{k}.1"], "evidence": [0]} for k in keys},
                "overall": {"band": band, "summary": "", "drift": []},
            }
        )

    return judge


def test_teacher_trials_are_opt_in_and_only_lift_the_try_as_student_prefix():
    assert sd.TEACHER_TRIAL_PREFIX == "preview-"
    for sql in (sd.selection_sql("`v`"), sd.transcript_sql("`v`"), sd.excluded_sources_sql("`v`")):
        assert "'preview-'" in sql  # default: unchanged, excluded
    for sql in (
        sd.selection_sql("`v`", include_teacher_trials=True),
        sd.transcript_sql("`v`", include_teacher_trials=True),
        sd.excluded_sources_sql("`v`", include_teacher_trials=True),
    ):
        assert "'preview-'" not in sql
        # A single-tutor preview and content-free teacher telemetry stay out either way.
        assert "NOT STARTS_WITH(IFNULL(group_id, ''), 'preview:')" in sql
        assert "NOT STARTS_WITH(IFNULL(group_id, ''), 'teacher:')" in sql
    assert sd.cohort_of(TRIAL_GROUP) == sd.COHORT_TEACHER_TRIAL
    assert sd.cohort_of("fys-a-1") == sd.COHORT_CLASSROOM and sd.cohort_of("") == sd.COHORT_CLASSROOM


def test_teacher_trials_are_labelled_and_kept_out_of_the_classroom_n_table():
    window = {"since": date(2026, 9, 26), "until": date(2026, 9, 30)}
    off = sd.select_sessions(TrialBQ(), "`v`", **window)
    assert "s-esru-trial" not in {s.session_id for s in off.sessions}
    assert "Teacher trials" not in sd.render_selection(off, ["esru", "poe"], 6)

    on = sd.select_sessions(TrialBQ(), "`v`", **window, include_teacher_trials=True)
    assert [s.session_id for s in on.teacher_trials] == ["s-esru-trial"]
    assert len(on.classroom) == 6 and all(s.cohort == sd.COHORT_CLASSROOM for s in on.classroom)
    md = sd.render_selection(on, ["esru", "poe"], 6)
    assert "| esru | 3 | 3 |" in md  # the classroom row did not grow
    assert "**Teacher trials**" in md and "| esru | mikkel | 1 | 8 |" in md
    assert TRIAL_GROUP not in md


def test_a_mocked_go_run_reports_teacher_trials_separately_never_pooled(bench, env, no_model_calls, tmp_path):
    rc = bench.main(
        [
            "--from-sessions",
            "--go",
            "--include-teacher-trials",
            "--since",
            "2026-09-26",
            "--until",
            "2026-09-30",
            "--out",
            str(tmp_path),
        ],
        query=TrialBQ(),
        judge=_fake_judge([]),
    )
    assert rc == 0
    report = (tmp_path / "report.md").read_text()
    head, _, trials = report.partition("## Teacher trials (Try as student)")
    # The classroom headline is exactly what it is without the trial session.
    assert "top of its own column 2 of 2 clear, 0 tied" in head
    assert "Sessions judged: **6**" in head
    assert "s-esru-trial" not in head
    assert trials and "| `s-esru-trial` | esru | mikkel | 8 |" in trials
    assert "MARK-" not in report

    scores = [json.loads(line) for line in (tmp_path / "raw_scores.jsonl").read_text().splitlines()]
    cohorts = {s["sessionId"]: s["cohort"] for s in scores}
    assert cohorts.pop("s-esru-trial") == "teacher trial"
    assert set(cohorts.values()) == {"classroom"}
    everything = "".join(p.read_text() for p in tmp_path.iterdir())
    assert TRIAL_GROUP not in everything


def test_dry_run_with_teacher_trials_counts_them_on_their_own_line(bench, env, no_model_calls, capsys):
    rc = bench.main(
        ["--from-sessions", "--dry-run", "--include-teacher-trials", "--since", "2026-09-26", "--until", "2026-09-30"],
        query=TrialBQ(),
    )
    out = capsys.readouterr().out
    assert rc == 0
    assert "sessions      : 6 in 6 groups" in out and "teacher trials: 1" in out
    assert TRIAL_GROUP not in out
