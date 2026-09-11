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

from pydantic import BaseModel, ConfigDict, Field, model_validator

from db.models.activity_config import MaterialRef

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
#: ``custom`` (1.1.110) is the honest home for free-text authoring. A custom
#: approach is WRITTEN, not derived from constructs traceable to a paper, and it
#: says so — which is exactly why removing the hand-written-instruction editor
#: from the published frameworks cost nothing: the capability stayed, the false
#: claim to a literature did not.
FrameworkLayer = Literal["tp_cycle", "conceptual", "custom"]

# ``placeholder`` — the slot exists, the pedagogy does not (AR/JB owe content).
# ``ready_for_review`` — constructs drafted, awaiting AR sign-off.
# ``ready`` — signed off; safe to generate tutor prompts from.
FrameworkStatus = Literal["placeholder", "ready_for_review", "ready"]

#: The voice an approach is delivered in (1.1.111). Formerly an INDEPENDENT axis
#: ("interaction style") chosen on a persona or an activity, alongside the
#: framework — which meant two people could pick two things that contradicted
#: each other, invisibly.
#:
#: They did. On prod, 2026-09-11: mikkel ran `concise` ("do not end with a
#: follow-up question") against ESRU, 23 of whose 42 moves are ask-moves; frida
#: ran `warm` ("offer a gentle hint before asking anything") against Accountable
#: Talk, 25 of 35; sofie the same against POE. Three of ten live assignments.
#:
#: So the register is now a property OF the approach, set once by whoever owns
#: the approach, visible in the same preview as the moves it has to live with.
#: `None` means the approach says nothing about voice — the old `socratic`
#: default, which injected nothing and therefore never clashed.
FrameworkRegister = Literal["concise", "rigorous", "warm"]

# The domains of scientific inquiry a teaching move can operate in. From
# Ruiz-Primo & Furtak (2007), who take them from Duschl: *epistemic frameworks*
# (how we know — evidence, predictions, data, the quality of a claim) and
# *conceptual structures* (what we know — definitions, relations between
# concepts). A third domain, *social processes*, they treat as inherent to any
# assessment conversation and do not code separately, so it is not modelled.
#
# ⚠️ Scope, and the paper is explicit about it: the dimensions distinguish
# **eliciting** strategies ONLY — "recognizing and using strategies (actions
# taken by the teacher) can be used as a reaction to any type of initial question
# and student response". So this tags a BEHAVIOUR, not a construct, and on most
# constructs every behaviour will leave it None. That asymmetry is the theory's,
# not an oversight.
InquiryDimension = Literal["epistemic", "conceptual"]


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


class Behaviour(BaseModel):
    """One observable, promptable teaching move, optionally tagged by inquiry
    dimension.

    Accepts a bare string in YAML (``- Ask for an explanation.``) as well as the
    tagged form, so a framework whose theory has no dimension axis stays simple
    to author.
    """

    text: str = Field(min_length=1, max_length=400)
    dimension: InquiryDimension | None = None

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def _accept_bare_string(cls, value):
        return {"text": value} if isinstance(value, str) else value


class Construct(BaseModel):
    """One thing the theory operates on, and what it looks like in a tutor turn.

    ``behaviours`` must be **observable and promptable** — "offer a choice of
    route", not "support autonomy". They are what a generated prompt is built
    from and what a reviewer checks it against.
    """

    name: str = Field(min_length=1, max_length=80)
    summary: str | None = Field(default=None, max_length=400)
    behaviours: list[Behaviour] = Field(default_factory=list, max_length=24)
    # Coded strategies the source treats as COUNTER-indicative — the moves that
    # mark the degeneration this framework is defined against. Ruiz-Primo &
    # Furtak's appendix codes these explicitly (evaluative "Yes! Good!",
    # yes/no questions, questions with no chance to answer, interrupting), and
    # they are exactly the moves an LLM tutor reaches for by default. Naming
    # them is worth more to a tutor prompt than another positive example.
    avoid: list[str] = Field(default_factory=list, max_length=12)
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

    # The voice this approach is delivered in — see FrameworkRegister. None is
    # the common and correct case: most approaches say what to DO and leave tone
    # alone, and an approach that declares nothing cannot contradict itself.
    # Python name differs from the wire name: a bare `register` shadows a
    # pydantic BaseModel attribute and warns at import.
    teaching_register: FrameworkRegister | None = Field(default=None, alias="register")

    # ── custom approaches (1.1.110) ──────────────────────────────────────────
    #
    # A custom approach carries its instruction as prose instead of deriving it
    # from constructs. Both fields are None/empty on every published framework,
    # so nothing about the seven changes.
    #
    # ⚠️ ``instruction_text`` is NOT a reintroduction of the editor that was
    # removed. The difference is the claim attached to it: this renders under a
    # heading that says it was authored, carries no provenance it did not earn,
    # and cannot be mistaken on screen for ESRU. The old editor overwrote a
    # derived prompt in place and left the badge saying "generated".
    instruction_text: str | None = Field(default=None, alias="instructionText", max_length=20000)

    # Documents this approach draws on. These are CurriculumDoc references and
    # they are consulted AT AUTHORING TIME (the co-pilot grounding its
    # proposals), never bound into a student session — that is a different
    # function (`build_curriculum_retrieval_tool`) which this never calls.
    material_refs: list[MaterialRef] = Field(default_factory=list, alias="materialRefs", max_length=20)

    # Ownership, mirroring ``Tutor``. Null on the seven published frameworks:
    # they are authored in git, and git records who wrote them.
    author_uid: str | None = Field(default=None, alias="authorUid", max_length=128)
    author_role: Literal["researcher", "teacher"] | None = Field(default=None, alias="authorRole")

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @property
    def is_custom(self) -> bool:
        """A free-text approach someone wrote, not a framework from the literature."""
        return self.layer == "custom"

    @property
    def is_placeholder(self) -> bool:
        """True while AR/JB still owe this framework its pedagogical content."""
        return self.status == "placeholder"

    def behaviour_lines(self) -> list[str]:
        """Every construct's behaviours, flattened — the raw material a generated
        tutor prompt is built from (1.1.91 M2 ``draft_tutor_prompt``)."""
        return [b.text for c in self.constructs for b in c.behaviours]

    def behaviours_in(self, dimension: InquiryDimension) -> list[str]:
        """Behaviours tagged with one inquiry dimension.

        The seam 1.1.92 scores against: "did this tutor elicit epistemically or
        conceptually?" is a real research question, and Ruiz-Primo & Furtak's own
        Table 4 answers it per teacher."""
        return [b.text for c in self.constructs for b in c.behaviours if b.dimension == dimension]


__all__ = [
    "Behaviour",
    "Construct",
    "FrameworkLayer",
    "FrameworkStatus",
    "InquiryDimension",
    "Provenance",
    "TeachingFramework",
]
