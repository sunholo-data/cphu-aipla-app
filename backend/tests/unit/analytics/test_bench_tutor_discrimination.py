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
    assert "tutor calls   : 210" in out  # 3 scenarios x 5 turns x 7 approaches x 2 models


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
        if prompt.startswith("You are checking a physics tutoring dialogue"):
            return json.dumps({"verdict": "challenged", "resolved": True, "rationale": "", "evidence": [3]})
        fw = next(f for f in fws if f"# Teaching approach: {f.label}" in prompt)
        keys = ff.criteria_block(fw)[1]
        band = "strong" if fw.id == "esru" else "partial"
        return json.dumps(
            {
                "constructs": {k: {"band": band, "rationale": "", "evidence": [1]} for k in keys},
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
    assert len(transcripts) == 3 * 3  # scenarios x approaches
    assert all(len(t["turns"]) == 10 for t in transcripts)
    # 9 transcripts x 3 fit calls + 3 probe transcripts x 1 sycophancy call
    assert len(judge_prompts) == 9 * 3 + 3
    for p in judge_prompts:
        assert "approach:" + "esru" not in p and "approach:poe" not in p and "approach:cer" not in p
        assert "INSTRUCTION FOR" not in p
    report = (tmp_path / "report.md").read_text()
    assert "## Tutor model: `gemini-3.5-flash-lite`" in report
    # Every transcript best-fits ESRU: 3 of 9 are right (the ESRU ones).
    assert "**Diagonal accuracy:** 0.33 (n=9" in report
    assert "Sycophancy probe" in report and "challenged" in report


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
