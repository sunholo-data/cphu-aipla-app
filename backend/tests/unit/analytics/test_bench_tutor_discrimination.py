"""The BENCH-1 harness (scripts/bench-tutor-discrimination.py) with mocked models.

The money properties first: --dry-run makes zero calls, and nothing is called
without --go. Then one full mocked run, to prove the producer label never
reaches a judge prompt and the three outputs are written.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

from analytics import framework_fidelity as ff
from frameworks.loader import load_frameworks

SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "bench-tutor-discrimination.py"


@pytest.fixture(scope="module")
def bench():
    spec = importlib.util.spec_from_file_location("bench_tutor_discrimination", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod  # @dataclass resolves its module through sys.modules
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def no_model_calls(monkeypatch):
    """Any real model call anywhere fails the test loudly."""
    import google.genai as genai

    def _boom(*a, **kw):
        raise AssertionError("a model client was constructed")

    async def _judge_boom(*a, **kw):
        raise AssertionError("the judge was called")

    monkeypatch.setattr(genai, "Client", _boom)
    monkeypatch.setattr("analytics.session_rubric._call_judge_model", _judge_boom)


def _forbidden_seams():
    calls = []

    def compose(fid):
        calls.append(("compose", fid))
        raise AssertionError("composed")

    async def tutor_turn(*a, **kw):
        calls.append(("tutor",))
        raise AssertionError("tutor called")

    async def judge(*a, **kw):
        calls.append(("judge",))
        raise AssertionError("judge called")

    return calls, compose, tutor_turn, judge


def test_dry_run_prints_the_plan_and_makes_no_calls(bench, no_model_calls, capsys):
    calls, compose, tutor_turn, judge = _forbidden_seams()
    rc = bench.main(["--dry-run"], compose=compose, tutor_turn=tutor_turn, judge=judge)
    out = capsys.readouterr().out
    assert rc == 0 and calls == []
    assert "TOTAL CALLS" in out and "no model was called" in out
    assert "tutor calls   : 630" in out  # 9 scenarios (1.1.151 F5) x 5 turns x 7 approaches x 2 models
    assert "tone          : 126" in out  # every transcript
    assert "n = 9 per cell" in out


def test_without_go_it_refuses(bench, no_model_calls, capsys):
    calls, compose, tutor_turn, judge = _forbidden_seams()
    rc = bench.main([], compose=compose, tutor_turn=tutor_turn, judge=judge)
    assert rc == 2 and calls == []
    assert "Refusing to call any model without --go" in capsys.readouterr().out


def test_an_unregistered_model_is_refused_before_anything_runs(bench, no_model_calls):
    with pytest.raises(SystemExit, match="not in the registry"):
        bench.main(["--dry-run", "--tutor-models", "gemini-9-ultra"])


def test_a_mocked_go_run_is_blind_and_writes_the_three_outputs(bench, no_model_calls, tmp_path, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "global")  # main() setdefaults it; keep it test-scoped
    fws = load_frameworks()
    judge_prompts: list[str] = []

    def compose(fid):
        return {
            "ok": True,
            "tutorId": f"approach:{fid}",
            "instruction": f"INSTRUCTION FOR {fid}",
            "composedFrom": {"skill": "concept-dialogue", "skillFound": True, "approachId": fid},
        }

    async def tutor_turn(composed, history, message, *, model, uid, turn_index):
        assert uid == "bench-tutor-discrimination"
        # A reply that makes the transcript identifiable ONLY by content, like a real one.
        return {"ok": True, "reply": f"Hvad tænker du? ({len(history)})", "tokenIn": 100, "tokenOut": 20}

    async def judge(prompt, model):
        judge_prompts.append(prompt)
        if "whether the TUTOR's praise is earned" in prompt:
            return json.dumps({"grade": "mild", "instances": [{"turn": 1, "quote": "Godt!", "why": "stock"}]})
        if prompt.startswith("You are checking a physics tutoring dialogue"):
            return json.dumps({"verdict": "challenged", "resolved": True, "rationale": "", "evidence": [3]})
        fw = next(f for f in fws if f"# Teaching approach: {f.label}" in prompt)
        keys = ff.criteria_block(fw)[1]
        band = "strong" if fw.id == "esru" else "partial"
        return json.dumps(
            {
                "constructs": {k: {"band": band, "rationale": "", "moves": [f"{k}.1"], "evidence": [1]} for k in keys},
                "overall": {"band": band, "summary": "", "drift": []},
            }
        )

    rc = bench.main(
        ["--go", "--tutor-models", "gemini-3.5-flash-lite", "--frameworks", "esru,poe,cer", "--out", str(tmp_path)],
        compose=compose,
        tutor_turn=tutor_turn,
        judge=judge,
    )
    assert rc == 0
    for name in ("report.md", "transcripts.jsonl", "raw_scores.jsonl"):
        assert (tmp_path / name).exists()
    transcripts = [json.loads(line) for line in (tmp_path / "transcripts.jsonl").read_text().splitlines()]
    assert len(transcripts) == 9 * 3  # scenarios (9 since 1.1.151 F5) x approaches
    assert all(len(t["turns"]) == 10 for t in transcripts)
    # 24 transcripts x (3 fit calls + 1 tone call) + 4 probe scenarios x 3 approaches x 1 sycophancy call
    assert len(judge_prompts) == 27 * 4 + 5 * 3  # 9 scenarios, 5 probes since 1.1.151 F5
    for p in judge_prompts:
        assert "approach:" + "esru" not in p and "approach:poe" not in p and "approach:cer" not in p
        assert "INSTRUCTION FOR" not in p
    report = (tmp_path / "report.md").read_text()
    assert "## Tutor model: `gemini-3.5-flash-lite`" in report
    # Every transcript best-fits ESRU: 8 of 24 are right (the ESRU ones) — argmax, kept for the record.
    assert "diagonal accuracy 0.33 (n=27" in report
    # Read down the columns, ESRU's tutor is not ahead (every tutor reads 1.0 there): the headline says so.
    assert "## Headline (column-normalised)" in report
    assert "top of its own column 0 of 3 clear, 3 tied" in report
    assert "Tone probe" in report and "| esru | 0 | 9 | 0 | 0 | 1.00 |" in report
    assert "Sycophancy probe" in report and "challenged" in report
    # Scores carry the arm in 1.1.92 M0's field names; the version is unknown, not guessed.
    scores = [json.loads(line) for line in (tmp_path / "raw_scores.jsonl").read_text().splitlines()]
    assert {s["frameworkId"] for s in scores} == {"esru", "poe", "cer"}
    assert all(s["tutorId"] == f"approach:{s['frameworkId']}" and s["tutorVersion"] is None for s in scores)
    assert all(s["groupId"].startswith("preview:") for s in scores)


def _compose(fid):
    return {
        "ok": True,
        "tutorId": f"approach:{fid}",
        "instruction": f"INSTRUCTION FOR {fid}",
        "composedFrom": {"skill": "concept-dialogue", "skillFound": True, "approachId": fid},
    }


def _flat_judge(fws):
    async def judge(prompt, model):
        if "whether the TUTOR's praise is earned" in prompt:
            return json.dumps({"grade": "none", "instances": []})
        if prompt.startswith("You are checking a physics tutoring dialogue"):
            return json.dumps({"verdict": "challenged", "resolved": True, "rationale": "", "evidence": [3]})
        fw = next(f for f in fws if f"# Teaching approach: {f.label}" in prompt)
        keys = ff.criteria_block(fw)[1]
        return json.dumps(
            {
                "constructs": {k: {"band": "partial", "rationale": "", "evidence": [1]} for k in keys},
                "overall": {"band": "partial", "summary": "", "drift": []},
            }
        )

    return judge


def test_a_429_tutor_turn_is_retried_and_a_400_keeps_its_message(bench, no_model_calls, tmp_path, monkeypatch):
    """BENCH-1 lost two transcripts to a bare "ClientError". Now a 429 retries
    (bounded, with backoff) and a 400 fails the transcript with its status and
    message on record."""
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "global")
    fws = load_frameworks()
    seen: dict[str, int] = {}
    sleeps: list[float] = []

    async def tutor_turn(composed, history, message, *, model, uid, turn_index):
        key = f"{composed['tutorId']}|{message[:20]}"
        seen[key] = seen.get(key, 0) + 1
        if composed["tutorId"] == "approach:poe" and turn_index == 1 and seen[key] == 1:
            return {"ok": False, "status": 429, "error": "ClientError 429: Resource exhausted."}
        if composed["tutorId"] == "approach:cer" and turn_index == 3:
            return {"ok": False, "status": 400, "error": "ClientError 400: Request contains an invalid argument."}
        return {"ok": True, "reply": "Hvad tænker du?", "tokenIn": 1, "tokenOut": 1}

    async def sleep(d):
        sleeps.append(d)

    rc = bench.main(
        [
            "--go",
            "--tutor-models",
            "gemini-3.5-flash-lite",
            "--frameworks",
            "poe,cer",
            "--only-scenarios",
            "slope-energy",
            "--out",
            str(tmp_path),
        ],
        compose=_compose,
        tutor_turn=tutor_turn,
        judge=_flat_judge(fws),
        sleep=sleep,
    )
    assert rc == 0
    ts = {t["producing"]: t for t in map(json.loads, (tmp_path / "transcripts.jsonl").read_text().splitlines())}
    assert ts["poe"]["ok"] and ts["poe"]["retries"] == 1 and sleeps == [2.0]
    assert not ts["cer"]["ok"]
    assert (
        ts["cer"]["error"] == "tutor turn 1 failed (status 400): ClientError 400: Request contains an invalid argument."
    )
    report = (tmp_path / "report.md").read_text()
    assert "retries on 429/5xx: tutor 1" in report and "invalid argument" in report


def test_report_only_rescores_a_run_with_zero_calls(bench, no_model_calls, tmp_path, capsys):
    calls, compose, tutor_turn, judge = _forbidden_seams()
    fixture = Path(__file__).parent / "fixtures" / "bench1_raw_scores_20260930.jsonl"
    run = tmp_path / "20260930T084604Z"
    run.mkdir()
    (run / "raw_scores.jsonl").write_text(fixture.read_text(encoding="utf-8"), encoding="utf-8")
    (run / "transcripts.jsonl").write_text(
        json.dumps({"id": "pendulum-amplitude|esru|gemini-3.5-flash-lite", "error": "tutor turn 1 failed: ClientError"})
        + "\n",
        encoding="utf-8",
    )
    rc = bench.main(["--report-only", str(run)], compose=compose, tutor_turn=tutor_turn, judge=judge)
    out = capsys.readouterr().out
    assert rc == 0 and calls == []
    assert "no model was called" in out
    assert "`gemini-3.8-flash`: own approach **top of its own column 3 of 7 clear, 2 tied**" in out
    report = (run / "report-rescored.md").read_text()
    assert "Re-scored" in report and "tutor turn 1 failed: ClientError" in report
    assert "Not assessed in this run" in report  # BENCH-1 had no tone probe
    # --rescore-from is the same flag
    assert bench.main(["--rescore-from", str(run), "--out", str(tmp_path / "o")]) == 0
    assert (tmp_path / "o" / "report-rescored.md").exists()


def test_a_missing_skill_stops_the_run_before_any_tutor_call(bench, no_model_calls, tmp_path, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "global")

    def compose(fid):
        return {
            "ok": True,
            "tutorId": f"approach:{fid}",
            "instruction": "approach only",
            "composedFrom": {"skill": "concept-dialogue", "skillFound": False, "approachId": fid},
        }

    async def tutor_turn(*a, **kw):  # pragma: no cover - must not run
        raise AssertionError("tutor called")

    with pytest.raises(SystemExit, match="was not found"):
        bench.main(["--go", "--out", str(tmp_path)], compose=compose, tutor_turn=tutor_turn, judge=None)
