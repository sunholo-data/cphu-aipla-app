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


__all__ = ["TeachingResolution", "resolve_teaching"]
