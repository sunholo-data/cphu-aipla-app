"""1.1.153: real tutor factory, synthetic activity, in-memory data only.

Run ``make eval-lesson-opening`` from the repo root (requires model credentials).
This checks default, teacher-authored and classroom handoff openings with two
scenarios each. OPENING_EVAL_PROJECT overrides the default AIPLA dev project.
"""

import os
from pathlib import Path

from google.adk.apps import App

from adk.agent import create_agent
from admin.platform_seed import _parse_template
from auth import User
from config.local_mode import is_local_mode
from db.activities import save_activity
from db.models import SkillConfig, SkillMetadata
from db.models.activity import Activity

if not is_local_mode():
    raise RuntimeError("The lesson-opening eval requires LOCAL_MODE=1 (synthetic in-memory data only).")

parsed = _parse_template(Path(__file__).resolve().parents[3] / "skills/templates/concept-dialogue/SKILL.md")
skill = SkillConfig(
    name=parsed["name"],
    description=parsed["description"],
    instructions=parsed["instructions"],
    proactiveGreet=parsed["proactiveGreet"],
    openingTemplate=parsed["openingTemplate"],
    skillMetadata=SkillMetadata.model_validate(parsed["metadata"]),
)
activity = save_activity(
    Activity(
        activityId="act-opening-eval",
        ownerUid="opening-eval",
        title="Elkedlens nyttevirkning",
        teachingGoal="Undersøg elkedlens nyttevirkning ved at vælge effekt og vandmængde og måle opvarmningstiden.",
        language="da",
        persona="mikkel",
        artefactId="kettle-efficiency",
        checklist=[{"id": "s1", "label": "Vælg effekt og vandmængde i simulationen"}],
        studentOpening=(
            "Velkommen til energilaboratoriet. Vælg 1500 W og 200 g vand. Notér jeres forudsigelse."
            if os.environ.get("OPENING_EVAL_VARIANT") in {"teacher", "classroom"}
            else ""
        ),
        openingByTeacher=os.environ.get("OPENING_EVAL_VARIANT") == "classroom",
    )
)
root_agent = create_agent(
    skill,
    User(uid="opening-eval", email="", auth_mode="anonymous_group_id", group_id="opening-eval"),
    activity_id=activity.activity_id,
)
app = App(name="lesson_opening", root_agent=root_agent)
