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
    class_persona_id: str | None = None,
    class_style: InteractionStyle | None = None,
) -> TeachingResolution:
    """Resolve the tutor bundle, falling back to the pre-tutor field path."""
    if cfg is not None and cfg.tutor_id:
        from db.tutors import resolve_tutor

        tutor = resolve_tutor(cfg.tutor_id)
        if tutor is not None:
            return TeachingResolution(
                tutor=tutor,
                persona_id=tutor.persona_id,
                framework_id=tutor.framework_id,
                interaction_style=tutor.interaction_style,
            )
        # An unknown id degrades to the old path rather than raising or
        # silently teaching differently (Axiom 5). Logged, because a teacher
        # picked something and it did not take effect.
        log.warning(
            "resolve_teaching: unknown tutor_id=%s on activity=%s — falling back to fields",
            cfg.tutor_id,
            cfg.activity_id,
        )

    return TeachingResolution(
        tutor=None,
        persona_id=(cfg.persona if cfg else None) or class_persona_id,
        framework_id=cfg.framework_id if cfg else None,
        interaction_style=(cfg.interaction_style if cfg else None) or class_style or "socratic",
    )


__all__ = ["TeachingResolution", "resolve_teaching"]
