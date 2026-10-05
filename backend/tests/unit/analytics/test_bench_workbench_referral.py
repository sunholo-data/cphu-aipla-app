"""1.1.149 M5 — the bench learns to see a workbench.

Mocked models throughout: the workbench scenarios load and validate, a mocked
``--go`` run composes each turn through the activity composer and grades every
transcript with the deterministic referral probe, and the REAL composer
(``compose_activity_turn``, the agent build a student gets) carries the block,
the framework preamble and the nudge — offline, in LOCAL_MODE.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
from pathlib import Path

import pytest

from analytics import framework_fidelity as ff
from analytics.framework_discrimination import load_scenarios
from frameworks.loader import load_frameworks

_REPO = Path(__file__).resolve().parents[4]
SCRIPT = _REPO / "scripts" / "bench-tutor-discrimination.py"
SCENARIOS = _REPO / "research" / "workbench-referral" / "scenarios.yaml"
BENCH2_SCENARIOS = _REPO / "research" / "tutor-discrimination" / "scenarios.yaml"


@pytest.fixture(scope="module")
def bench():
    spec = importlib.util.spec_from_file_location("bench_tutor_discrimination_wb", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_the_workbench_scenarios_load_with_a_sim_a_table_and_a_stuck_turn():
    scenarios = load_scenarios(SCENARIOS)
    assert {s.id for s in scenarios} == {"projectile-boldkast", "kettle-efficiency", "wave-interference"}
    for s in scenarios:
        assert s.activity is not None and s.activity.artefact_id
        assert s.activity.table and s.activity.checklist
        assert s.stuck_turn is not None
        assert s.probe is None  # no planted wrong claim: the sycophancy probe abstains


def test_the_bench2_scenarios_are_untouched():
    """Kept apart so BENCH-2's original eight stay comparable. 1.1.151 F5 added a
    ninth (``asks-for-a-break``) on purpose; comparisons with earlier BENCH-2 runs
    use the original eight, so assert those are intact rather than a count."""
    scenarios = load_scenarios(BENCH2_SCENARIOS)
    original = {
        "pendulum-amplitude",
        "ball-thrown-up",
        "heavier-falls-faster",
        "current-used-up",
        "truck-and-car",
        "slope-energy",
        "steel-ship-floats",
        "pitch-and-amplitude",
    }
    assert original <= {s.id for s in scenarios}
    assert all(s.activity is None and s.stuck_turn is None for s in scenarios)


def test_a_stuck_turn_without_an_activity_is_refused(tmp_path):
    p = tmp_path / "s.yaml"
    p.write_text("scenarios:\n  - id: x\n    studentTurns: [a, b, c, d]\n    probe: {stuckTurn: 1}\n", encoding="utf-8")
    with pytest.raises(ValueError, match="only means something with an activity"):
        load_scenarios(p)


def test_an_unknown_sim_is_refused_before_any_call(tmp_path):
    p = tmp_path / "s.yaml"
    p.write_text(
        "scenarios:\n  - id: x\n    studentTurns: [a, b, c, d]\n    activity: {artefactId: no-such-sim}\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="unknown sim"):
        load_scenarios(p)


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
        fw = next(f for f in fws if f"# Teaching approach: {f.label}" in prompt)
        keys = ff.criteria_block(fw)[1]
        return json.dumps(
            {
                "constructs": {k: {"band": "partial", "rationale": "", "evidence": [1]} for k in keys},
                "overall": {"band": "partial", "summary": "", "drift": []},
            }
        )

    return judge


def test_a_mocked_run_composes_each_turn_and_grades_referrals(bench, tmp_path, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "global")
    composed_turns: list[tuple[str, str, int]] = []

    async def activity_compose(fid, cfg, history, message):
        composed_turns.append((fid, cfg.activity_id, len(history)))
        return f"LESSON INSTRUCTION {fid} {cfg.activity_id}"

    async def tutor_turn(composed, history, message, *, model, uid, turn_index):
        assert composed["instruction"].startswith("LESSON INSTRUCTION")
        # ESRU refers from its first turn; POE never does.
        reply = "Prøv simuleringen og fortæl mig hvad du ser?" if "esru" in composed["instruction"] else "Hvorfor?"
        return {"ok": True, "reply": reply, "tokenIn": 10, "tokenOut": 5}

    rc = bench.main(
        [
            "--go",
            "--tutor-models",
            "gemini-3.5-flash-lite",
            "--frameworks",
            "esru,poe",
            "--scenarios",
            str(SCENARIOS),
            "--out",
            str(tmp_path),
        ],
        compose=_compose,
        tutor_turn=tutor_turn,
        judge=_flat_judge(load_frameworks()),
        activity_compose=activity_compose,
    )
    assert rc == 0
    # Composed per TURN (history grows 0, 2, 4, ...), for every transcript.
    assert len(composed_turns) == 3 * 2 * 5
    assert sorted({n for _, _, n in composed_turns}) == [0, 2, 4, 6, 8]

    scores = [json.loads(line) for line in (tmp_path / "raw_scores.jsonl").read_text().splitlines()]
    by_fw = {s["frameworkId"]: s["referral"] for s in scores if s["scenario"] == "kettle-efficiency"}
    assert by_fw["esru"]["firstReferralTurn"] == 1 and by_fw["esru"]["afterStuck"] is True
    assert by_fw["poe"]["firstReferralTurn"] is None and by_fw["poe"]["afterStuck"] is False

    report = (tmp_path / "report.md").read_text()
    assert "## Workbench referral (1.1.149)" in report
    assert "| `esru` | 3 | 100% (3/3) | 100% (3/3) | 1.00 |" in report
    assert "| `poe` | 3 | 0% (0/3) | 0% (0/3) | 0.00 |" in report


def test_a_bench2_report_has_no_referral_section(bench):
    rows = [{"ok": True, "tutorModel": "m", "producing": "esru", "referral": None}]
    assert bench.render_referral_section(rows, order=["esru"], tutor_models=["m"]) == ""


# --- the real composer, offline ------------------------------------------------------


@pytest.fixture
def _local(monkeypatch):
    from db import firestore as fs_module

    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _skill():
    from admin.platform_seed import _parse_template
    from db.models import SkillConfig, SkillMetadata

    parsed = _parse_template(_REPO / "backend" / "skills" / "templates" / "concept-dialogue" / "SKILL.md")
    return SkillConfig(
        name="concept-dialogue",
        description="t",
        instructions=parsed["instructions"],
        skillId="55555555-5555-5555-5555-555555555555",
        skillMetadata=SkillMetadata(model="gemini-2.5-flash"),
    )


def test_the_real_composer_builds_the_lesson_prompt_a_student_gets(bench, _local, monkeypatch):
    import skills.skill_config as sc
    from db.framework_overrides import resolve_framework_instruction

    monkeypatch.setattr(sc, "find_by_slug", lambda owner, slug: _skill())
    kettle = next(s for s in load_scenarios(SCENARIOS) if s.id == "kettle-efficiency")

    first = asyncio.run(bench.compose_activity_turn("esru", kettle.activity, [], kettle.student_turns[0]))
    block_at = first.index("WORKBENCH — what the student has beside this chat")
    assert 'Simulation "Elkedel — energi og nyttevirkning"' in first
    assert 'Data table "Måleskema"' in first
    assert first.index(resolve_framework_instruction("esru")[:200]) < block_at
    assert "There is no simulator on screen" not in first
    assert "Reminder:" not in first

    history = []
    for i in range(3):
        history += [{"role": "student", "content": kettle.student_turns[i]}, {"role": "tutor", "content": "Hvorfor?"}]
    later = asyncio.run(bench.compose_activity_turn("esru", kettle.activity, history, kettle.student_turns[3]))
    assert "Reminder: your last 3 replies" in later
