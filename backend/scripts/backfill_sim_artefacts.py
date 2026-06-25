"""Migrate the 3 sim-skill activities onto the artefact model (USR-1).

Each migrated sim activity runs a sim SKILL (problem-set-hints / led-planck-tutor /
kinebot-kinematics-tutor) but carries no `artefact_id` — the sim was rendered by the
legacy slug path. This sets `artefact_id` so the **generic** artefact mount drives it
(editor preview === runtime), and lifts the bespoke React workbench's non-sim UI into
generic activity **elements** (sub-parts → checklist, problem/instructions → note) so
the teacher can see + edit them in the builder.

Idempotent (skips an activity already pointing at the right artefact). Dry-run by
default; `--apply` writes. Additive — never deletes.

Usage:
    uv run python -m scripts.backfill_sim_artefacts          # dry-run
    uv run python -m scripts.backfill_sim_artefacts --apply
"""

from __future__ import annotations

import argparse
import logging

from db.activities import save_activity
from db.firestore import query_documents
from db.models.activity import Activity

log = logging.getLogger(__name__)

# Sim skill name → its sandboxed artefact id (env-independent; resolved via the
# skill's name, not its per-environment UUID).
SIM_SKILL_TO_ARTEFACT = {
    "problem-set-hints": "boldkast",
    "led-planck-tutor": "led-planck",
    "kinebot-kinematics-tutor": "kinebot",
}

# Boldkast sub-parts — lifted from the hardcoded BOLDKAST_SUBPARTS in the chat page
# into a generic checklist element (teacher-editable).
BOLDKAST_SUBPARTS = [
    {"id": "a", "label": "a) Hvor lang tid er bolden i luften?"},
    {"id": "b", "label": "b) Hvor langt rækker den (vandret distance)?"},
    {"id": "c", "label": "c) Hvad er den maksimale højde?"},
    {"id": "d", "label": "d) Tegn en skitse over banen."},
]

# LED-Planck intro/formula — lifted from the bespoke LedPlanckWorkbench "Om dette
# eksperiment" section into a generic note element.
LED_NOTE = {
    "id": "om-eksperimentet",
    "title": "Om dette eksperiment",
    "body": (
        "En LED begynder først at lyse, når spændingen overstiger en tærskelværdi "
        "U₀, som afhænger af LED'ens farve. Ved at måle U₀ og bølgelængden λ for "
        "flere farver kan Plancks konstant bestemmes:\n\n`h = U₀ · e · λ / c`"
    ),
}


def _skill_name(skill_id: str) -> str | None:
    try:
        from skills.skill_config import get_skill

        s = get_skill(skill_id)
        return getattr(s, "name", None) if s else None
    except Exception:
        return None


def _problem_statement(skill_id: str) -> str:
    try:
        from skills.skill_config import get_skill

        s = get_skill(skill_id)
        return (getattr(s, "problem_statement", "") if s else "") or ""
    except Exception:
        return ""


def _all_activities() -> list[Activity]:
    return [Activity.model_validate(d) for d in query_documents("activities") if not d.get("deletedAt")]


def run(*, dry_run: bool = True) -> dict:
    migrated: list[str] = []
    skipped: list[str] = []
    for a in _all_activities():
        name = _skill_name(a.skill_id)
        artefact = SIM_SKILL_TO_ARTEFACT.get(name or "")
        if artefact is None:
            continue
        if a.artefact_id == artefact:
            skipped.append(a.activity_id)
            continue
        updates: dict = {"artefact_id": artefact, "workbench_type": "app"}
        if name == "problem-set-hints":
            if not a.checklist:
                updates["checklist"] = BOLDKAST_SUBPARTS
            ps = _problem_statement(a.skill_id)
            if ps and not a.note:
                updates["note"] = [{"id": "opgave", "title": "Opgave", "body": ps}]
        elif name == "led-planck-tutor" and not a.note:
            updates["note"] = [LED_NOTE]
        if not dry_run:
            save_activity(a.model_copy(update=updates))
        migrated.append(f"{a.activity_id} ({name}→{artefact})")
    return {"migrated": migrated, "skipped": skipped}


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill sim activities onto the artefact model (USR-1)")
    parser.add_argument("--apply", action="store_true", help="actually write (default is dry-run)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    report = run(dry_run=not args.apply)
    mode = "APPLIED" if args.apply else "DRY-RUN"
    log.info(
        "[%s] migrated %d sim activities, skipped %d already-on-artefact",
        mode,
        len(report["migrated"]),
        len(report["skipped"]),
    )
    for line in report["migrated"]:
        log.info("  %s", line)
    if not args.apply:
        log.info("\nDry-run only. Re-run with --apply to write.")


# Exposed for tests.
__all__ = ["BOLDKAST_SUBPARTS", "LED_NOTE", "SIM_SKILL_TO_ARTEFACT", "run"]


if __name__ == "__main__":
    main()
