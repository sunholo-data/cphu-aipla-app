"""Where a teacher is on the way to their first live lesson (1.1.124 M0).

Every granted teacher gets a demo class on first sign-in, so the stuck state is
not "empty" — it is *"still only the demo, N days after being granted"* — and
until this module nothing anywhere showed it. The stage is **derived from stored
state** (the access register, the classes a uid owns, the per-class activity
summary the class list already fetches); no telemetry, no new writes.

One function, two consumers: the researcher's per-teacher view on the Programme
page and the teacher's own getting-started checklist. Both read THIS definition,
so they cannot disagree about what "stuck" means.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from db.models.class_ import Class
from onboarding.demo_seed import DEMO_CLASS_NAME

Stage = Literal["invited", "demo_only", "no_code", "no_activity", "waiting", "live"]

#: Ordered — later stages are further along. The order is load-bearing for the
#: Programme page's "stuck longest" sort and for the checklist's tick marks.
STAGES: tuple[Stage, ...] = ("invited", "demo_only", "no_code", "no_activity", "waiting", "live")

#: The next thing to do at each stage, worded as the guide's own step headings
#: (t1 / t2) so the researcher's nudge to a teacher writes itself. ``live`` has
#: no next step. Copy lives here so the two consumers say the same words.
NEXT_STEP: dict[Stage, str | None] = {
    "invited": "Sign in with the invited address",
    "demo_only": "Create the class",
    "no_code": "Mint a group code",
    "no_activity": "Add an activity",
    "waiting": "Share the join link with students",
    "live": None,
}


@dataclass(frozen=True)
class TeacherStage:
    stage: Stage
    #: When the teacher entered this stage, if known: the grant for ``invited``,
    #: the latest class creation for the class-shaped stages, the last message
    #: for ``live``. ``None`` when nothing dates it.
    since: datetime | None
    next_step: str | None

    @property
    def days(self) -> int | None:
        """Whole days spent in this stage, or ``None`` when ``since`` is unknown."""
        if self.since is None:
            return None
        return max(0, (datetime.now(UTC) - self.since).days)

    def to_dict(self) -> dict:
        return {
            "stage": self.stage,
            "since": self.since.isoformat() if self.since else None,
            "days": self.days,
            "nextStep": self.next_step,
        }


def is_demo_class(cls: Class) -> bool:
    """The seeded demo — by marker since 1.1.124, by name for the classes
    seeded before the marker existed. A teacher who renames their demo class
    has, for this purpose, made it their own."""
    return cls.demo or cls.name == DEMO_CLASS_NAME


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def compute_stage(
    *,
    uid: str | None,
    granted_at: str | None,
    classes: list[Class],
    activity_by_class: dict[str, dict],
) -> TeacherStage:
    """Derive a teacher's stage.

    ``classes`` are the non-revoked classes the uid owns; ``activity_by_class``
    is ``summarize_activity_for_group_codes`` per class id (``turns``,
    ``lastMessageAt``, …) — the same read the class list performs, passed in so
    this stays a pure function.

    The rule walks the funnel from the far end: the most advanced thing the
    teacher has done is their stage. A teacher with one live class and three
    empty ones is *live*; the empty ones are not a problem to flag.
    """
    if not uid:
        return TeacherStage("invited", _parse_iso(granted_at), NEXT_STEP["invited"])

    own = [c for c in classes if not is_demo_class(c)]
    if not own:
        # Signed in, nothing but the seed. Date it from the grant — that is when
        # the clock the researcher cares about started.
        return TeacherStage("demo_only", _parse_iso(granted_at), NEXT_STEP["demo_only"])

    def latest_created(cs: list[Class]) -> datetime | None:
        return max((c.created_at for c in cs), default=None)

    # Live: any own class with a student turn.
    live_at: datetime | None = None
    for c in own:
        last = _parse_iso((activity_by_class.get(c.class_id) or {}).get("lastMessageAt"))
        if (activity_by_class.get(c.class_id) or {}).get("turns", 0) > 0 and last:
            live_at = max(live_at, last) if live_at else last
    if live_at:
        return TeacherStage("live", live_at, None)

    ready = [c for c in own if c.group_codes and c.activity_ids]
    if ready:
        return TeacherStage("waiting", latest_created(ready), NEXT_STEP["waiting"])

    with_codes = [c for c in own if c.group_codes]
    if with_codes:
        return TeacherStage("no_activity", latest_created(with_codes), NEXT_STEP["no_activity"])

    return TeacherStage("no_code", latest_created(own), NEXT_STEP["no_code"])
