"""Competency-rubric lens engine (1.1.57 / RUBRIC-1, the 2.5-planned module).

Post-hoc, per-session judge lenses over published rubrics — Lens C (MAPS,
Docktor et al. 2016, CC-BY) and Lens D (SAAR, Etkina et al. 2006). NEVER
live-cadenced (cost + the evidence-integrity rule make a rolling competency
score meaningless) and NEVER teacher-facing until R1 — consumers are the CLI
(``aiplatform rubric``) and the researcher settings surface (M3).

Three rules carried from the design doc:

1. **Evidence integrity.** A tutor is a scaffolding machine that destroys the
   evidence a competency rubric needs. The judge scores only student-INITIATED
   turns (:func:`partition_evidence`); tutor-prompted answers are context,
   never competence. The partition rides every result for audit.
2. **Abstain over fabricate.** No per-activity anchor pack → the lens reports
   *uncalibrated* and withholds scores (human raters only reached κ 0.94 with
   anchors; minimally-trained raters κ ≈ 0.32).
3. **Provenance.** Every result stamps ``{lens_id, prompt_version, model,
   partition_summary}`` — the researcher-versioned-prompt-layer principle: a
   stored score is only interpretable next to the prompt that produced it.

Config: code defaults below, merged under a Firestore override at
``analytics_lens_configs/{lens_id}`` (the 1.1.42 override⊕default pattern);
the M3 researcher surface writes the override.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from db.firestore import get_document
from reports.session_summary import SessionSummary, SessionTurn

logger = logging.getLogger(__name__)

_CONFIG_COLLECTION = "analytics_lens_configs"
_ANCHOR_COLLECTION = "rubric_anchor_packs"

#: Anchor-pack floor (Docktor's calibration finding): fewer than this and the
#: lens abstains. The CLI's ``rubric anchors validate`` lints the same bound.
MIN_ANCHORS = 5


# --- Lens registry (code defaults; Firestore override merges on top) ---


@dataclass(frozen=True)
class LensSpec:
    lens_id: str
    label: str
    model: str
    prompt_version: str
    enabled: bool = True


LENS_REGISTRY: dict[str, LensSpec] = {
    # Lens C — MAPS problem-solving judge (Docktor et al. 2016, CC-BY).
    "maps": LensSpec(
        lens_id="maps",
        label="MAPS problem solving (Docktor 2016)",
        model="gemini-2.5-flash",
        prompt_version="maps-r1",
    ),
    # Lens D — SAAR scientific-abilities judge (Etkina et al. 2006);
    # judge prompt lands in RUBRIC-1 M2 (testing-experiment rows 1-8).
    "saar": LensSpec(
        lens_id="saar",
        label="SAAR scientific abilities (Etkina 2006)",
        model="gemini-2.5-flash",
        prompt_version="saar-r1",
    ),
}


class LensConfig(BaseModel):
    """The effective lens config: Firestore override merged over the code default."""

    lens_id: str
    label: str
    model: str
    prompt_version: str
    enabled: bool = True
    prompt_override: str | None = None

    model_config = ConfigDict(populate_by_name=True)


def get_lens_config(lens_id: str) -> LensConfig:
    """Effective config for one lens; raises ``KeyError`` for an unknown lens."""
    spec = LENS_REGISTRY[lens_id]  # KeyError is the contract for unknown lenses
    base = {
        "lens_id": spec.lens_id,
        "label": spec.label,
        "model": spec.model,
        "prompt_version": spec.prompt_version,
        "enabled": spec.enabled,
        "prompt_override": None,
    }
    override = get_document(_CONFIG_COLLECTION, lens_id) or {}
    for key in ("model", "prompt_version", "enabled", "prompt_override", "label"):
        if key in override and override[key] is not None:
            base[key] = override[key]
    return LensConfig(**base)


def list_lens_configs() -> list[LensConfig]:
    return [get_lens_config(lens_id) for lens_id in LENS_REGISTRY]


# --- Evidence partition (deterministic-first, returned for audit) ---


@dataclass
class EvidencePartition:
    """Student turns split by evidence quality (1.1.57 evidence-integrity rule)."""

    student_initiated: list[SessionTurn] = field(default_factory=list)
    tutor_prompted: list[SessionTurn] = field(default_factory=list)

    @property
    def summary(self) -> dict[str, int]:
        return {
            "student_initiated": len(self.student_initiated),
            "tutor_prompted": len(self.tutor_prompted),
        }


def _tutor_turn_prompts(content: str) -> bool:
    """Deterministic rule: a tutor turn that ASKS (ends with, or contains, a
    question) scaffolds the next student turn. Statements don't."""
    return "?" in content


def partition_evidence(turns: list[SessionTurn]) -> EvidencePartition:
    """Split student turns into initiated vs tutor-prompted.

    Deterministic-first (auditable, no model call): a student turn immediately
    following a tutor turn that asks a question is **tutor_prompted** — the
    student is answering the scaffold. Everything else the student volunteers
    (openers, unprompted explanations/workings after tutor statements) is
    **student_initiated**. The margins are imperfect by design; the partition
    is returned with every score so a researcher can audit it (the 1.1.57
    mitigation), and MAPS' own validation found honest dialogue partitions
    ADD evidence relative to paper.
    """
    p = EvidencePartition()
    prev: SessionTurn | None = None
    for turn in turns:
        if turn.role == "student":
            if prev is not None and prev.role == "tutor" and _tutor_turn_prompts(prev.content):
                p.tutor_prompted.append(turn)
            else:
                p.student_initiated.append(turn)
        prev = turn
    return p


# --- Anchor packs (AR/JB-authored; 1.1.57 M1 — absent packs mean abstain) ---


def load_anchor_pack(activity_id: str) -> dict[str, Any] | None:
    """The activity's anchor pack, or ``None`` (→ the lens abstains)."""
    if not activity_id:
        return None
    doc = get_document(_ANCHOR_COLLECTION, activity_id)
    anchors = (doc or {}).get("anchors") or []
    if len(anchors) < MIN_ANCHORS:
        return None
    return doc


# --- MAPS judge (Lens C) ---

# The five Docktor categories. NOTE: concise paraphrases pending the verbatim
# CC-BY Table I text from the scoping-site extraction
# (sources/aswin-competencies-2026-06-29/) — swap in verbatim + keep the
# attribution line when the archive syncs to this machine.
_MAPS_CATEGORIES = {
    "useful_description": "Useful Description — organises given information into an appropriate, useful representation (sketch, symbols, coordinates, knowns/unknowns).",
    "physics_approach": "Physics Approach — selects appropriate physics concepts and principles for the problem.",
    "specific_application": "Specific Application of Physics — applies the chosen principles correctly to the SPECIFIC conditions of this problem.",
    "mathematical_procedures": "Mathematical Procedures — follows appropriate and correct mathematical rules and procedures.",
    "logical_progression": "Logical Progression — the solution progresses coherently: focused, consistent, logically connected end to end.",
}

_MAPS_ATTRIBUTION = (
    "Rubric: Docktor et al. (2016), 'Assessing student written problem solutions: A problem-solving "
    "rubric with application to introductory physics', PRPER 12, 010130 (CC-BY 3.0)."
)


def _format_anchors(pack: dict[str, Any]) -> str:
    lines = []
    for i, a in enumerate(pack.get("anchors", [])[:8]):
        lines.append(
            f"Anchor {i + 1}: {a.get('solution', '')}\nScores: {a.get('scores', {})}\nWhy: {a.get('rationale', '')}"
        )
    return "\n\n".join(lines)


def build_maps_prompt(partition: EvidencePartition, pack: dict[str, Any], config: LensConfig) -> str:
    """Assemble the MAPS judge prompt. Scores PROCESS, not answers — expert
    solvers get wrong answers a significant fraction of the time — and applies
    the consistency rule (an early error carried through consistently is not
    re-penalised)."""
    preamble = config.prompt_override or (
        "You are a physics-education research judge scoring a student's problem-solving PROCESS "
        "with the MAPS rubric. Score each category 0-5, or NA_problem (the problem doesn't elicit "
        "the category) or NA_solver (the student produced no independent evidence for it). "
        "Do NOT reward a correct final answer as such: expert problem solvers generate incorrect "
        "answers a significant fraction of the time — the categories score process quality. "
        "Apply the consistency rule: an early error used consistently afterwards is penalised once, "
        "not in every category it touches."
    )
    evidence = "\n".join(f"- {t.content}" for t in partition.student_initiated)
    return "\n\n".join(
        [
            preamble,
            _MAPS_ATTRIBUTION,
            "Categories:\n" + "\n".join(f"- {key}: {text}" for key, text in _MAPS_CATEGORIES.items()),
            "Calibration anchors for THIS activity (scored examples with rationales):\n" + _format_anchors(pack),
            "STUDENT-INITIATED evidence (the ONLY scorable material — everything the tutor "
            "prompted out of the student has been excluded as scaffolded):\n" + evidence,
            'Return STRICT JSON: {category_key: {"score": 0-5 | "NA_problem" | "NA_solver", '
            '"rationale": "one sentence"}} for exactly these keys: ' + ", ".join(_MAPS_CATEGORIES),
        ]
    )


# --- Judge execution ---


async def _call_judge_model(prompt: str, model: str) -> str:
    """One judged model call (the analytics/summarise genai precedent).
    Isolated as a seam so tests and the CLI's --dry-run can stub it."""
    from google import genai
    from google.genai.types import GenerateContentConfig

    client = genai.Client(vertexai=True)
    response = await client.aio.models.generate_content(
        model=model,
        contents=prompt,
        config=GenerateContentConfig(temperature=0.0, response_mime_type="application/json"),
    )
    return response.text or ""


def _parse_profile(raw: str, expected_keys: list[str]) -> dict[str, Any]:
    text = raw.strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    profile = json.loads(text)
    return {k: profile.get(k, {"score": "NA_problem", "rationale": "missing from judge output"}) for k in expected_keys}


class RubricResult(BaseModel):
    """One lens's scored (or abstained) result for one session."""

    session_id: str = Field(alias="sessionId")
    activity_id: str = Field(alias="activityId")
    lens_id: str = Field(alias="lensId")
    prompt_version: str = Field(alias="promptVersion")
    model: str
    abstained: bool = False
    abstain_reason: str = Field(default="", alias="abstainReason")
    profile: dict[str, Any] = Field(default_factory=dict)
    partition_summary: dict[str, int] = Field(default_factory=dict, alias="partitionSummary")

    model_config = ConfigDict(populate_by_name=True)


def _abstain(summary: SessionSummary, config: LensConfig, partition: EvidencePartition, reason: str) -> RubricResult:
    return RubricResult(
        sessionId=summary.session_id,
        activityId=summary.activity_id,
        lensId=config.lens_id,
        promptVersion=config.prompt_version,
        model=config.model,
        abstained=True,
        abstainReason=reason,
        partitionSummary=partition.summary,
    )


async def score_session_summary(summary: SessionSummary, lens_id: str) -> RubricResult:
    """Score one session with one lens — abstaining, never fabricating.

    Post-hoc only. Abstains (with the reason) when the lens is disabled, the
    activity has no ≥{MIN_ANCHORS}-anchor pack, or the partition holds no
    student-initiated evidence.
    """
    config = get_lens_config(lens_id)
    partition = partition_evidence(summary.conversation)

    if not config.enabled:
        return _abstain(summary, config, partition, f"lens {lens_id!r} is disabled")
    pack = load_anchor_pack(summary.activity_id)
    if pack is None:
        return _abstain(
            summary,
            config,
            partition,
            f"uncalibrated: no anchor pack (>= {MIN_ANCHORS} scored anchors) for activity {summary.activity_id!r}",
        )
    if not partition.student_initiated:
        return _abstain(summary, config, partition, "no student-initiated evidence in this session")

    if lens_id == "maps":
        prompt = build_maps_prompt(partition, pack, config)
        expected = list(_MAPS_CATEGORIES)
    else:  # pragma: no cover — SAAR prompt lands in RUBRIC-1 M2
        return _abstain(summary, config, partition, f"lens {lens_id!r} has no judge prompt yet")

    raw = await _call_judge_model(prompt, config.model)
    profile = _parse_profile(raw, expected)
    logger.info("rubric: scored session=%s lens=%s version=%s", summary.session_id, lens_id, config.prompt_version)
    return RubricResult(
        sessionId=summary.session_id,
        activityId=summary.activity_id,
        lensId=config.lens_id,
        promptVersion=config.prompt_version,
        model=config.model,
        profile=profile,
        partitionSummary=partition.summary,
    )


async def score_session(session_id: str, lens_id: str) -> RubricResult | None:
    """Resolve a captured session and score it — the CLI / M3-surface entry.
    ``None`` when the session can't be resolved."""
    from reports.session_summary import resolve_session_summary

    summary = await resolve_session_summary(session_id)
    if summary is None:
        return None
    return await score_session_summary(summary, lens_id)


__all__ = [
    "LENS_REGISTRY",
    "MIN_ANCHORS",
    "EvidencePartition",
    "LensConfig",
    "RubricResult",
    "build_maps_prompt",
    "get_lens_config",
    "list_lens_configs",
    "load_anchor_pack",
    "partition_evidence",
    "score_session",
    "score_session_summary",
]
