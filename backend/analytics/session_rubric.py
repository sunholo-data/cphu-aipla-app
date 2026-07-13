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

from db.firestore import get_document, query_documents, set_document
from reports.session_summary import SessionSummary, SessionTurn

logger = logging.getLogger(__name__)

_CONFIG_COLLECTION = "analytics_lens_configs"
_ANCHOR_COLLECTION = "rubric_anchor_packs"
#: Researcher-authored free-form rubrics (RUBRIC-2 M1). Unioned with the seed
#: code lenses below — a new framework is a new doc here, not a code change.
_RUBRIC_DEFS_COLLECTION = "rubric_defs"

#: Default judge model for a researcher rubric that doesn't pin one.
_DEFAULT_JUDGE_MODEL = "gemini-2.5-flash"

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
    """The effective config for one rubric — a seed lens (code default merged
    under a Firestore override) or a free-form researcher rubric (RUBRIC-2 M1,
    stored whole in ``rubric_defs``)."""

    lens_id: str
    label: str
    model: str
    prompt_version: str
    enabled: bool = True
    prompt_override: str | None = None
    #: The code-default judge preamble (read-only reference for the settings
    #: surface). Never persisted for seed lenses — derived from the lens id at
    #: read time. For a researcher rubric it holds the stored prompt.
    default_prompt: str = ""
    #: RUBRIC-2 M1 — free-form rubric extras (empty/defaults for seed lenses,
    #: which carry their categories/scale in their hardcoded prompt builders).
    family: str = ""
    output_keys: list[str] = Field(default_factory=list)
    score_scale: str = ""
    #: Seed lenses (maps/saar) always require a calibration anchor pack (the
    #: 1.1.57 discipline). Researcher rubrics default to NOT requiring one so a
    #: new framework can be tried immediately; flip on when it graduates.
    requires_anchors: bool = True
    is_seed: bool = True
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(populate_by_name=True)


def _rubric_def_to_config(doc: dict[str, Any]) -> LensConfig:
    """Build the effective config for a researcher-authored ``rubric_defs`` doc."""
    rid = doc["rubric_id"]
    return LensConfig(
        lens_id=rid,
        label=doc.get("label") or rid,
        model=doc.get("model") or _DEFAULT_JUDGE_MODEL,
        prompt_version=doc.get("prompt_version") or f"{rid}-r1",
        enabled=doc.get("enabled", True),
        prompt_override=None,  # for a rubric_def the stored prompt IS the default
        default_prompt=doc.get("prompt", ""),
        family=doc.get("family", ""),
        output_keys=list(doc.get("output_keys") or []),
        score_scale=doc.get("score_scale", ""),
        requires_anchors=bool(doc.get("requires_anchors", False)),
        is_seed=False,
        meta=doc.get("meta") or {},
    )


def get_lens_config(lens_id: str) -> LensConfig:
    """Effective config for one rubric; raises ``KeyError`` for an unknown id.

    Seed lenses (``LENS_REGISTRY``) merge a Firestore override over the code
    default; anything else is looked up as a free-form ``rubric_defs`` doc.
    """
    if lens_id in LENS_REGISTRY:
        spec = LENS_REGISTRY[lens_id]
        base = {
            "lens_id": spec.lens_id,
            "label": spec.label,
            "model": spec.model,
            "prompt_version": spec.prompt_version,
            "enabled": spec.enabled,
            "prompt_override": None,
            # Read-only reference for the settings surface (never stored / overridable).
            "default_prompt": LENS_DEFAULT_PROMPTS.get(lens_id, ""),
            "requires_anchors": True,
            "is_seed": True,
        }
        override = get_document(_CONFIG_COLLECTION, lens_id) or {}
        for key in ("model", "prompt_version", "enabled", "prompt_override", "label"):
            if key in override and override[key] is not None:
                base[key] = override[key]
        return LensConfig(**base)

    doc = get_document(_RUBRIC_DEFS_COLLECTION, lens_id)
    if doc is None:
        raise KeyError(lens_id)  # the unknown-rubric contract
    return _rubric_def_to_config(doc)


def list_rubric_defs() -> list[dict[str, Any]]:
    """Every researcher-authored rubric doc (RUBRIC-2 M1)."""
    return query_documents(_RUBRIC_DEFS_COLLECTION)


def list_lens_configs() -> list[LensConfig]:
    """Seed lenses + every free-form researcher rubric."""
    configs = [get_lens_config(lens_id) for lens_id in LENS_REGISTRY]
    for doc in list_rubric_defs():
        rid = doc.get("rubric_id")
        if rid and rid not in LENS_REGISTRY:
            configs.append(_rubric_def_to_config(doc))
    return configs


def upsert_rubric_def(
    rubric_id: str,
    *,
    label: str,
    prompt: str,
    output_keys: list[str],
    family: str = "",
    score_scale: str = "",
    model: str | None = None,
    requires_anchors: bool = False,
    meta: dict[str, Any] | None = None,
    updated_by: str = "",
) -> dict[str, Any]:
    """Create or update a free-form researcher rubric.

    A prompt change bumps ``prompt_version`` (``{id}-r{n}``) so stored scores
    stay interpretable against the prompt that produced them. Refuses to shadow
    a seed lens id (``maps``/``saar``) — those are code-owned.
    """
    if rubric_id in LENS_REGISTRY:
        raise ValueError(f"{rubric_id!r} is a seed lens; edit it via /lens-configs, not /rubrics")
    if not output_keys:
        raise ValueError("a scorable rubric needs at least one output key")

    existing = get_document(_RUBRIC_DEFS_COLLECTION, rubric_id) or {}
    prev_version = existing.get("prompt_version", f"{rubric_id}-r0")
    if prompt != existing.get("prompt"):
        rev = (int(prev_version.rsplit("-r", 1)[-1]) if "-r" in prev_version else 0) + 1
        version = f"{rubric_id}-r{rev}"
    else:
        version = prev_version

    doc = {
        "rubric_id": rubric_id,
        "label": label or rubric_id,
        "family": family,
        "prompt": prompt,
        "output_keys": list(output_keys),
        "score_scale": score_scale,
        "model": model or _DEFAULT_JUDGE_MODEL,
        "requires_anchors": requires_anchors,
        "prompt_version": version,
        "enabled": existing.get("enabled", True),
        "meta": meta if meta is not None else existing.get("meta", {}),
        "created_by": existing.get("created_by") or updated_by,
        "updated_by": updated_by,
    }
    set_document(_RUBRIC_DEFS_COLLECTION, rubric_id, {**existing, **doc}, merge=True)
    logger.info("rubric: upsert rubric_def %s version=%s by=%s", rubric_id, version, updated_by)
    return doc


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


# The DEFAULT judge preamble (the editable "instructions" layer a researcher's
# prompt_override replaces). Named + exported so the settings surface can SHOW
# it — a researcher edits from it rather than from a blank box. The rubric
# categories, calibration anchors, attribution, and student evidence are always
# assembled AROUND the preamble (see build_maps_prompt), never overridable.
_MAPS_DEFAULT_PREAMBLE = (
    "You are a physics-education research judge scoring a student's problem-solving PROCESS "
    "with the MAPS rubric. Score each category 0-5, or NA_problem (the problem doesn't elicit "
    "the category) or NA_solver (the student produced no independent evidence for it). "
    "Do NOT reward a correct final answer as such: expert problem solvers generate incorrect "
    "answers a significant fraction of the time — the categories score process quality. "
    "Apply the consistency rule: an early error used consistently afterwards is penalised once, "
    "not in every category it touches."
)


def build_maps_prompt(partition: EvidencePartition, pack: dict[str, Any], config: LensConfig) -> str:
    """Assemble the MAPS judge prompt. Scores PROCESS, not answers — expert
    solvers get wrong answers a significant fraction of the time — and applies
    the consistency rule (an early error carried through consistently is not
    re-penalised)."""
    preamble = config.prompt_override or _MAPS_DEFAULT_PREAMBLE
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


# --- SAAR judge (Lens D — testing-experiment rows, RUBRIC-1 M2) ---

# Etkina et al. (2006) scientific-abilities rubric, testing-experiment scope
# (Appendix A items 1-8), 0-3 scale: 0 missing / 1 inadequate / 2 needs
# improvement / 3 adequate. NOTE: concise paraphrases pending the verbatim
# open-access rows from the scoping-site extraction — swap in verbatim + keep
# attribution when the archive syncs (same caveat as the MAPS table above).
_SAAR_ROWS = {
    "identify_hypothesis": "Identifies the hypothesis to be tested.",
    "design_reliable_test": "Designs a reliable experiment that TESTS the hypothesis — one whose outcome could refute it, not merely confirm it.",
    "distinguish_hypothesis_prediction": "Distinguishes between the hypothesis and the prediction that follows from it.",
    "make_prediction": "Makes a reasonable prediction based on the hypothesis (if the hypothesis holds, then ...).",
    "identify_assumptions": "Identifies the assumptions the prediction relies on.",
    "compare_prediction_outcome": "Determines explicitly whether the prediction and the experimental outcome agree.",
    "judge_hypothesis": "Makes a reasonable judgment about the hypothesis from the outcome.",
    "revise_when_needed": "Revises the hypothesis when the outcome demands it (NA_problem when no revision was warranted).",
}

_SAAR_ATTRIBUTION = (
    "Rubric: Etkina et al. (2006), 'Scientific abilities and their assessment', "
    "PRST-PER 2, 020103 (open access; quoted with citation)."
)

# The canonical calibration contrast (the paper's Tables X/XI pattern):
# refutation-oriented design scores 3; a confirmation-bias design — testing
# only cases the hypothesis/agent is expected to get right — scores 1
# ("Student B", the canonical negative). Illustrative pending the verbatim
# graded transcripts from the archive.
_SAAR_FEW_SHOT = (
    "Calibration contrast:\n"
    "- SCORE 3 (refutation-oriented): 'My agent should explain units. I will test it with trick "
    "cases designed to REFUTE it — mixed units, a dimensionless quantity, and a case outside its "
    "instructions — and state beforehand what outcome would falsify my design.'\n"
    "- SCORE 1 (confirmation-oriented, the classic negative): 'My agent should explain units. "
    "I tested it on three standard unit conversions it handled fine, so my design works.' The "
    "design only sought confirmation; nothing about it could have refuted the hypothesis."
)


# The DEFAULT SAAR judge preamble — the editable layer (see _MAPS_DEFAULT_PREAMBLE).
_SAAR_DEFAULT_PREAMBLE = (
    "You are a physics-education research judge scoring a student's INQUIRY PROCESS with the "
    "SAAR scientific-abilities rubric (testing-experiment scope). Score each row 0 (missing), "
    "1 (inadequate), 2 (needs improvement) or 3 (adequate); NA_problem when the session gave "
    "no occasion for the row. The decisive discriminator is refutation-orientation: a design "
    "that could not possibly refute the hypothesis scores 1 on design_reliable_test no matter "
    "how tidy it looks."
)


#: lens_id -> the default (code) judge preamble. The settings surface shows
#: this so a researcher edits FROM the default instead of a blank box.
LENS_DEFAULT_PROMPTS: dict[str, str] = {
    "maps": _MAPS_DEFAULT_PREAMBLE,
    "saar": _SAAR_DEFAULT_PREAMBLE,
}


def build_saar_prompt(partition: EvidencePartition, pack: dict[str, Any], config: LensConfig) -> str:
    """Assemble the SAAR (Lens D) judge prompt — 0-3 per testing-experiment row."""
    preamble = config.prompt_override or _SAAR_DEFAULT_PREAMBLE
    evidence = "\n".join(f"- {t.content}" for t in partition.student_initiated)
    return "\n\n".join(
        [
            preamble,
            _SAAR_ATTRIBUTION,
            "Rows:\n" + "\n".join(f"- {key}: {text}" for key, text in _SAAR_ROWS.items()),
            _SAAR_FEW_SHOT,
            "Calibration anchors for THIS activity:\n" + _format_anchors(pack),
            "STUDENT-INITIATED evidence (the ONLY scorable material — tutor-prompted turns are "
            "excluded as scaffolded):\n" + evidence,
            'Return STRICT JSON: {row_key: {"score": 0-3 | "NA_problem", "rationale": "one sentence"}} '
            "for exactly these keys: " + ", ".join(_SAAR_ROWS),
        ]
    )


# --- Generic judge (RUBRIC-2 M1 — free-form researcher rubrics) ---


def build_generic_prompt(partition: EvidencePartition, pack: dict[str, Any], config: LensConfig) -> str:
    """Assemble the judge prompt for a free-form rubric.

    The researcher's stored prompt is the whole framework; we wrap it with the
    same evidence-integrity guarantees the seed judges use (student-initiated
    evidence only, anchors when present) and a strict-JSON contract over the
    rubric's declared ``output_keys``.
    """
    preamble = config.prompt_override or config.default_prompt
    evidence = "\n".join(f"- {t.content}" for t in partition.student_initiated)
    parts = [preamble]
    anchors = _format_anchors(pack) if pack.get("anchors") else ""
    if anchors:
        parts.append("Calibration anchors for THIS activity:\n" + anchors)
    parts.append(
        "STUDENT-INITIATED evidence (the ONLY scorable material — tutor-prompted "
        "turns are excluded as scaffolded):\n" + evidence
    )
    scale = f" on the scale {config.score_scale}" if config.score_scale else ""
    parts.append(
        'Return STRICT JSON: {key: {"score": <score' + scale + '>, "rationale": "one sentence"}} '
        "for exactly these keys: " + ", ".join(config.output_keys)
    )
    return "\n\n".join(parts)


# --- Judge execution ---


async def _call_judge_model(prompt: str, model: str, images: list[Any] | None = None) -> str:
    """One judged model call (the analytics/summarise genai precedent).

    Isolated as a seam so tests and the CLI's --dry-run can stub it. When
    ``images`` are given (RUBRIC-2 M2 — uploaded evidence), the call is
    multimodal: the prompt text plus each image Part."""
    from google import genai
    from google.genai.types import GenerateContentConfig

    client = genai.Client(vertexai=True)
    contents: Any = [prompt, *images] if images else prompt
    response = await client.aio.models.generate_content(
        model=model,
        contents=contents,
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
    #: RUBRIC-2 M2 — uploaded evidence the judge saw (``doc:{id}``/``image:{id}``).
    evidence_refs: list[str] = Field(default_factory=list, alias="evidenceRefs")

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
    if config.requires_anchors and pack is None:
        return _abstain(
            summary,
            config,
            partition,
            f"uncalibrated: no anchor pack (>= {MIN_ANCHORS} scored anchors) for activity {summary.activity_id!r}",
        )
    if not partition.student_initiated:
        return _abstain(summary, config, partition, "no student-initiated evidence in this session")

    pack = pack or {"anchors": []}  # generic path tolerates an absent pack when not required

    if lens_id == "maps":
        prompt = build_maps_prompt(partition, pack, config)
        expected = list(_MAPS_CATEGORIES)
    elif lens_id == "saar":
        prompt = build_saar_prompt(partition, pack, config)
        expected = list(_SAAR_ROWS)
    elif config.output_keys:
        prompt = build_generic_prompt(partition, pack, config)
        expected = list(config.output_keys)
    else:  # a rubric with no declared keys can't be scored
        return _abstain(summary, config, partition, f"rubric {lens_id!r} has no output keys to score")

    # RUBRIC-2 M2 — reference the session's uploaded material (same as the tutor
    # saw): documents lead the prompt as context; images ride a multimodal call.
    from analytics.rubric_evidence import format_document_evidence, load_session_evidence

    evidence = await load_session_evidence(summary.session_id, summary.activity_id)
    doc_block = format_document_evidence(evidence)
    if doc_block:
        prompt = doc_block + "\n\n" + prompt

    if evidence.image_parts:
        raw = await _call_judge_model(prompt, config.model, images=evidence.image_parts)
    else:
        raw = await _call_judge_model(prompt, config.model)
    profile = _parse_profile(raw, expected)
    logger.info(
        "rubric: scored session=%s lens=%s version=%s evidence=%d",
        summary.session_id,
        lens_id,
        config.prompt_version,
        len(evidence.refs),
    )
    return RubricResult(
        sessionId=summary.session_id,
        activityId=summary.activity_id,
        lensId=config.lens_id,
        promptVersion=config.prompt_version,
        model=config.model,
        profile=profile,
        partitionSummary=partition.summary,
        evidenceRefs=evidence.refs,
    )


async def score_session(session_id: str, lens_id: str) -> RubricResult | None:
    """Resolve a captured session and score it — the CLI / M3-surface entry.
    ``None`` when the session can't be resolved."""
    from reports.session_summary import resolve_session_summary

    summary = await resolve_session_summary(session_id)
    if summary is None:
        return None
    return await score_session_summary(summary, lens_id)


# --- Group-code addressing (RUBRIC-2 M0) ---

#: A group JOIN code is ``<adjective>-<noun>-<NN>`` (``auth/group_id_wordlist``)
#: — three hyphen-parts with a numeric tail. An ADK session id is a 5-part
#: UUID, so the shape cleanly disambiguates the two without a wordlist lookup
#: (demo codes like ``aipla-demo-1`` aren't in the wordlist but share the shape).
_GROUP_CODE_RE = re.compile(r"[a-z][a-z0-9]*-[a-z0-9]+-\d+")


def looks_like_group_code(target: str) -> bool:
    """True if ``target`` has the group-join-code shape (vs a session id)."""
    return bool(_GROUP_CODE_RE.fullmatch(target.strip()))


def resolve_target(target: str) -> list[str]:
    """Resolve a researcher-supplied target to session ids, newest-first.

    A group code (``crisp-pebble-21``) → every session the group produced (via
    the BQ turn log); anything else is treated as a session id verbatim.
    Researchers only ever hold group codes — internal session UUIDs never
    surface in the CLI or API (1.1.57 group-code-addressing rule).
    """
    t = target.strip()
    if looks_like_group_code(t):
        from reports.session_summary import find_all_session_ids_for_group_bq

        return find_all_session_ids_for_group_bq(t)
    return [t]


async def score_target(target: str, lens_id: str) -> RubricResult | None:
    """Score the LATEST session for a target (group code or session id).

    ``None`` when a group code has no sessions or a session id won't resolve.
    Backfilling *every* session for a group is RUBRIC-2 M4.
    """
    session_ids = resolve_target(target)
    if not session_ids:
        return None
    return await score_session(session_ids[0], lens_id)


__all__ = [
    "LENS_DEFAULT_PROMPTS",
    "LENS_REGISTRY",
    "MIN_ANCHORS",
    "EvidencePartition",
    "LensConfig",
    "RubricResult",
    "build_generic_prompt",
    "build_maps_prompt",
    "build_saar_prompt",
    "get_lens_config",
    "list_lens_configs",
    "list_rubric_defs",
    "load_anchor_pack",
    "looks_like_group_code",
    "partition_evidence",
    "resolve_target",
    "score_session",
    "score_session_summary",
    "score_target",
    "upsert_rubric_def",
]
