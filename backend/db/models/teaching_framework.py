"""TeachingFramework — the pedagogical theory a tutor operationalises (1.1.91 M0).

A tutor's theory is **structured data, not a prompt string**, because a researcher
has to defend it: to a reviewer in the Applied AI overview, and to a teacher asking
why this tutor behaves as it does. ``constructs -> behaviours`` is what makes a
generated prompt *reviewable* — a reader can check the prompt against the theory
instead of taking it on faith — and ``evaluation_hint`` is the seam to 1.1.92, so a
tutor claiming to support a construct states at design time how you would know,
rather than having a rubric retro-fitted to it later.

Defaults ship as YAML in ``backend/frameworks/*.yaml``, mirroring the persona
catalogue (1.1.12). Firestore-authored frameworks are 1.1.91 M1 — hence ``source``.

**Naming.** Deliberately ``TeachingFramework``, not ``Framework``:
``adk/authoring_framework.py`` (1.1.50) already owns "framework" for the *activity
co-pilot's* authoring pedagogy. Different concept, different layer.

**Human gate.** The seven catalogue entries below the ESRU one ship as *slots*
(``status="placeholder"``) — AR/JB own the pedagogical content, exactly as
``authoring_framework.FRAMEWORK_IS_PLACEHOLDER`` marks the co-pilot's rubric.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Which stack a framework belongs to. The 2026-09-08 literature set
# (``docs/literature/tp-framework/README.md``) keeps these deliberately APART:
# the teaching-practice cycle methods are the promptable teaching moves, while
# SDT and embodied cognition were "deferred to the conceptual framework
# (research/theoretical perspective), not the TP cycle".
#
# NOTE (1.1.91 open question, for JB): the design doc assumed a PARENT pointer —
# "Embodied Cognition is the umbrella theory, with SDT incorporated inside it".
# The literature set describes two separate layers rather than a tree, so this is
# a flat discriminator. Revisit before M5 seeds conceptual-layer entries.
FrameworkLayer = Literal["tp_cycle", "conceptual"]

# ``placeholder`` — the slot exists, the pedagogy does not (AR/JB owe content).
# ``ready_for_review`` — constructs drafted, awaiting AR sign-off.
# ``ready`` — signed off; safe to generate tutor prompts from.
FrameworkStatus = Literal["placeholder", "ready_for_review", "ready"]


class Provenance(BaseModel):
    """Where a framework's claim comes from, and who stands behind it.

    ⚠️ ``vouched_by`` has **no default, minimum length 1**. That is the point of
    this model: 1.1.91 makes "the co-pilot must not invent citations" a hard
    requirement, and the tutor co-pilot (M2) is where a model could violate it.
    An unvouched citation is unconstructable here, so the guard is in the type
    system before the tool that would need guarding exists.
    """

    citation: str = Field(min_length=1, max_length=500)
    # Initials of the human who confirmed this citation (repo convention: M, JB,
    # AR, DS, ZL, P2, K). Never a model.
    vouched_by: str = Field(min_length=1, max_length=40, alias="vouchedBy")
    # 800, not 400: a provenance note carries the edition/venue caveats and the
    # record of a correction ("this looked like two papers, it is one") — the
    # exact material a later reader needs and 400 chars could not hold.
    note: str | None = Field(default=None, max_length=800)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class Construct(BaseModel):
    """One thing the theory operates on, and what it looks like in a tutor turn.

    ``behaviours`` must be **observable and promptable** — "offer a choice of
    route", not "support autonomy". They are what a generated prompt is built
    from and what a reviewer checks it against.
    """

    name: str = Field(min_length=1, max_length=80)
    summary: str | None = Field(default=None, max_length=400)
    behaviours: list[str] = Field(default_factory=list, max_length=12)
    # How you would tell whether it worked -> 1.1.92's rubric adapters.
    evaluation_hint: str | None = Field(default=None, alias="evaluationHint", max_length=400)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class TeachingFramework(BaseModel):
    """A named pedagogy, its constructs, and the literature it rests on."""

    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=120)
    summary: str = Field(default="", max_length=800)
    layer: FrameworkLayer = "tp_cycle"
    constructs: list[Construct] = Field(default_factory=list, max_length=20)
    provenance: list[Provenance] = Field(default_factory=list, max_length=10)
    status: FrameworkStatus = "placeholder"
    source: Literal["yaml", "firestore"] = "yaml"

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @property
    def is_placeholder(self) -> bool:
        """True while AR/JB still owe this framework its pedagogical content."""
        return self.status == "placeholder"

    def behaviour_lines(self) -> list[str]:
        """Every construct's behaviours, flattened — the raw material a generated
        tutor prompt is built from (1.1.91 M2 ``draft_tutor_prompt``)."""
        return [b for c in self.constructs for b in c.behaviours]


__all__ = [
    "Construct",
    "FrameworkLayer",
    "FrameworkStatus",
    "Provenance",
    "TeachingFramework",
]
