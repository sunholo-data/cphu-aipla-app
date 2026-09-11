"""One join for "what is teaching this turn?" (1.1.91 M1).

Before this module the answer was assembled in three places: the persona chain
resolved the avatar and voice, ``interaction_style`` resolved the tone, and
``tutor_framework`` resolved the pedagogy. Each read the ``ActivityConfig``
separately and each could disagree with the others.

A ``Tutor`` bundles all three, so this resolves **once** and everything reads the
result. The precedence is the same everywhere:

    activity.tutor_id  >  the activity's individual fields  >  class  >  default

**The individual fields are not dead.** Every activity authored before tutors
existed has a ``persona`` and an ``interaction_style`` and no ``tutor_id``, and
must keep behaving exactly as it does. So a missing tutor falls through to
precisely the old path rather than to a new default — which is why this returns a
resolution object rather than mutating anything.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import dataclass

from db.models.activity_config import ActivityConfig, InteractionStyle
from db.models.tutor import Tutor

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class TeachingResolution:
    """What is teaching this turn, from whichever layer supplied it."""

    tutor: Tutor | None
    persona_id: str | None
    framework_id: str | None
    interaction_style: InteractionStyle

    @property
    def source(self) -> str:
        """Which layer decided — for the OTel span, so a surprising turn can be
        traced to the config that produced it rather than guessed at."""
        return "tutor" if self.tutor is not None else "fields"


def resolve_teaching(
    cfg: ActivityConfig | None,
    *,
    class_tutor_id: str | None = None,
    class_persona_id: str | None = None,
    class_style: InteractionStyle | None = None,
) -> TeachingResolution:
    """Resolve the tutor bundle, falling back to the pre-tutor field path.

    Order: the activity's tutor > the CLASS's tutor > the activity's individual
    fields > the class persona > the default. The class layer is where identity
    lives by the 1.1.32 Q4 decision, so in practice the class tutor is the one
    that resolves and the activity override is the escape hatch.
    """
    from db.tutors import resolve_tutor

    for candidate, layer in ((cfg.tutor_id if cfg else None, "activity"), (class_tutor_id, "class")):
        if not candidate:
            continue
        tutor = resolve_tutor(candidate)
        if tutor is not None:
            return TeachingResolution(
                tutor=tutor,
                persona_id=tutor.persona_id,
                framework_id=tutor.framework_id,
                interaction_style=tutor.interaction_style,
            )
        log.warning(
            "resolve_teaching: unknown %s tutor_id=%s — falling back",
            layer,
            candidate,
        )
    return TeachingResolution(
        tutor=None,
        persona_id=(cfg.persona if cfg else None) or class_persona_id,
        framework_id=cfg.framework_id if cfg else None,
        interaction_style=(cfg.interaction_style if cfg else None) or class_style or "socratic",
    )


@dataclass(frozen=True)
class TeachingContext:
    """Everything that decided how this turn was taught, for the record.

    1.1.91 TUTOR-5. The chat-log pipeline recorded ``skill_id`` and nothing
    about the pedagogy, so "show me every conversation taught with ESRU" was not
    a question the data could answer — the teaching style was never written
    down.

    ⚠️ It cannot be recovered afterwards by joining. You could walk
    group -> class -> tutor -> framework, but a class's tutor CHANGES: a
    conversation from last week would be attributed to whatever that class
    teaches with today. That silently files rows under arms they never ran
    under, which is worse than showing nothing because it looks like evidence.
    So this is stamped at emit time, when it is a fact rather than an inference.

    Resolved through ``resolve_teaching`` like everything else — the log records
    what ACTUALLY taught, not a second derivation that could disagree with it.
    """

    tutor_id: str | None
    framework_id: str | None
    persona_id: str | None
    class_id: str | None
    activity_id: str | None
    #: The register the turn was actually delivered in.
    #:
    #: ⚠️ **Its meaning changed on 2026-09-11 (1.1.111)** and the column name did
    #: not. Before: an INDEPENDENT axis set on a persona or activity, which the
    #: prompt carried whether or not it agreed with the teaching approach beside
    #: it. After: the register declared BY the approach, which is the only thing
    #: that now reaches the prompt. A row from before that date records a choice
    #: someone made separately; a row after records a property of the approach.
    #:
    #: Rows are NOT backfilled, for the reason TUTOR-5 gives throughout: a wrong
    #: label that looks like evidence is worse than a null.
    interaction_style: InteractionStyle | None
    #: "tutor" when a Tutor object decided, "fields" when the pre-tutor
    #: activity/class fields did. Distinguishes "no framework was configured"
    #: from "a tutor was chosen that carries none" — different findings.
    source: str


def resolve_teaching_context(
    activity_id: str | None,
    *,
    group_tags: Iterable[str] | None = None,
    cfg: ActivityConfig | None = None,
) -> TeachingContext:
    """The full teaching context for ``activity_id``, for logging and display.

    ``cfg`` may be passed when the caller has already resolved the active
    config, to avoid a second read of the same document.

    Never raises. This runs on the telemetry path, where a failure must cost a
    null column and not a lesson (Axiom 5) — an unresolvable context returns
    all-None rather than propagating.
    """
    from adk.teacher_focus import class_id_from_group_tags, resolve_active_config

    try:
        if cfg is None and activity_id:
            cfg = resolve_active_config(activity_id, group_tags=group_tags)
        class_id = (cfg.class_id if cfg is not None else None) or class_id_from_group_tags(group_tags)

        class_tutor_id = None
        class_persona_id = None
        if class_id:
            from db.classes import get_class

            cls = get_class(class_id)
            class_tutor_id = getattr(cls, "tutor_id", None)
            class_persona_id = getattr(cls, "persona", None)

        r = resolve_teaching(
            cfg,
            class_tutor_id=class_tutor_id,
            class_persona_id=class_persona_id,
        )
        # 1.1.111: the register comes from the APPROACH, because the standalone
        # axis is retired and no longer reaches the prompt. Logging the old
        # value would record something inert as though it had taught the turn —
        # the researcher lens shows this column, and an inert value there is a
        # finding manufactured from a dead field.
        register = None
        if r.framework_id:
            from db.framework_overrides import effective_framework

            fw = effective_framework(r.framework_id)
            register = fw.teaching_register if fw is not None else None

        return TeachingContext(
            tutor_id=r.tutor.id if r.tutor is not None else None,
            framework_id=r.framework_id,
            persona_id=r.persona_id,
            class_id=class_id,
            activity_id=activity_id,
            interaction_style=register,
            source=r.source,
        )
    except Exception as exc:
        log.warning("resolve_teaching_context: failed for activity=%s: %s", activity_id, exc)
        return TeachingContext(
            tutor_id=None,
            framework_id=None,
            persona_id=None,
            class_id=None,
            activity_id=activity_id,
            interaction_style=None,
            source="unresolved",
        )


__all__ = [
    "TeachingContext",
    "TeachingResolution",
    "resolve_teaching",
    "resolve_teaching_context",
]
