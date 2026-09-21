"""Framework fidelity — did the tutor stick to the teaching approach it ran?
(1.1.107 M0 + M5, the single-framework real-session case scoped 2026-09-16.)

*"The sessions report should also include an analysis of how the teaching
framework was used and how much it was stuck to — the report should only
report on the teaching framework that tutor used, it doesn't need to compare
across."*

This is a DIFFERENT instrument from the competency lenses in
``session_rubric``, and the difference is the evidence rule:

* MAPS/SAAR ask *how competent is the student?* and score only
  student-initiated turns — the tutor is scaffolding noise, discarded.
* This asks *did the session exhibit the approach's own criteria?* — and the
  tutor's moves are the subject. ESRU is Elicit → Student response →
  Recognise → **Use**, a cycle across BOTH speakers; Accountable Talk's uptake
  is by definition a response to what someone else said. So the unit here is
  a **dialogue unit**: the ordered tutor/student sequence, turn ids preserved
  (:func:`dialogue_units`). Never a bag of student utterances.

The criteria are **generated from the framework's own YAML** — constructs,
behaviours, ``avoid`` lists and ``evaluationHint``s — the same structure that
instructs the tutor (``adk/authoring_framework``), read in the other
direction. Authoring them apart would guarantee drift between what the tutor
was told to do and what the judge looks for; generating them from one source
makes drift impossible.

Three rules carried from the design doc:

1. **Blind to the arm.** The prompt says *assess this dialogue against these
   criteria*; it never says *this tutor was configured to do this*. A judge
   told the arm finds the arm.
2. **Fit is not quality.** A teacher-facing read is PROSE — what the approach
   looked like in this session and where it drifted — never a grade of the
   teacher or the student. Bands and scores stay behind the researcher gate
   (the 1.1.65 R1 discipline), the same split the competency lenses use.
3. **Abstain over fabricate.** No framework on the session, a placeholder
   framework, or too little dialogue → *not assessable*, said as such.

Where the class recorded its lesson, the spoken transcript rides as a second,
labelled evidence block. For a ``group_talk`` approach (Accountable Talk) it
is the only place the community exists; for every other approach it is
context the judge may cite for student-side criteria but not for tutor moves.

Results are stored in the RUBRIC-2 run store under ``lens_id =
"fidelity:<framework_id>"`` — same provenance, same idempotent run id, no
second store — and cached from there for the report.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from config.models import default_model, provider_for_api_name
from db.framework_overrides import effective_framework
from db.models.teaching_framework import TeachingFramework
from reports.session_summary import SessionSummary, SessionTurn

logger = logging.getLogger(__name__)

PROMPT_VERSION = "fidelity-r1"

#: Fewer tutor turns than this and there is no approach to assess — a greeting
#: and one reply is not a teaching episode. Abstain, do not extrapolate.
MIN_TUTOR_TURNS = 3

#: Coarse bands (open question 1 of the design: bands in the UI, the number in
#: the store). Ordered, so a caller can compare.
BANDS = ("absent", "partial", "strong")
_BAND_SCORE = {"absent": 0, "partial": 1, "strong": 2}

#: Turn cap on the dialogue block — a long session is scored on its most
#: recent part, which is also where drift shows. The count is reported.
MAX_TURNS = 80


# --- M0: dialogue-unit evidence -------------------------------------------------


@dataclass(frozen=True)
class DialogueUnit:
    index: int
    role: str  # "tutor" | "student"
    content: str


@dataclass
class DialogueEvidence:
    """Ordered tutor+student turns — the evidence rule that INCLUDES the tutor.

    ``summary`` rides the result so a researcher can audit what was scored,
    exactly as ``EvidencePartition.summary`` does for the competency lenses.
    """

    units: list[DialogueUnit] = field(default_factory=list)
    truncated_from: int | None = None

    @property
    def tutor_turns(self) -> int:
        return sum(1 for u in self.units if u.role == "tutor")

    @property
    def student_turns(self) -> int:
        return sum(1 for u in self.units if u.role == "student")

    @property
    def summary(self) -> dict[str, int]:
        out = {"units": len(self.units), "tutor": self.tutor_turns, "student": self.student_turns}
        if self.truncated_from is not None:
            out["truncated_from"] = self.truncated_from
        return out


def dialogue_units(turns: list[SessionTurn], *, max_turns: int = MAX_TURNS) -> DialogueEvidence:
    """The ordered dialogue, turn ids preserved, tutor turns INCLUDED.

    Deliberately not ``session_rubric.partition_evidence``: that rule discards
    the tutor, and the tutor is what this instrument measures.
    """
    total = len(turns)
    window = turns[-max_turns:] if total > max_turns else turns
    offset = total - len(window)
    units = [
        DialogueUnit(index=offset + i, role=t.role, content=(t.content or "").strip())
        for i, t in enumerate(window)
        if (t.content or "").strip()
    ]
    return DialogueEvidence(units=units, truncated_from=total if total > max_turns else None)


# --- The criteria, generated from the framework ---------------------------------


def _construct_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")


def criteria_block(fw: TeachingFramework) -> tuple[str, list[str]]:
    """Render the framework's constructs as scoring criteria.

    Returns the text and the ordered construct keys the judge must answer for.
    Everything here is the YAML read back: behaviours are what to look FOR,
    ``avoid`` is what counts AGAINST, the evaluation hint is the construct's
    own question. Nothing is paraphrased, so a reader can hold the judge's
    criteria against the published framework page line by line.
    """
    keys: list[str] = []
    lines: list[str] = []
    for c in fw.constructs:
        key = _construct_key(c.name)
        keys.append(key)
        lines.append(f"### {key}")
        if c.summary:
            lines.append(" ".join(c.summary.split()))
        if c.behaviours:
            lines.append("Moves that show it:")
            lines += [f"- {b.text}" for b in c.behaviours]
        if c.avoid:
            lines.append("Counts against it:")
            lines += [f"- {a}" for a in c.avoid]
        if c.evaluation_hint:
            lines.append("Question to answer: " + " ".join(c.evaluation_hint.split()))
        lines.append("")
    return "\n".join(lines).strip(), keys


def build_fidelity_prompt(fw: TeachingFramework, evidence: DialogueEvidence, voice_transcript: str | None) -> str:
    """Assemble the judge prompt. Blind to the arm: names the criteria, never
    the configuration."""
    criteria, keys = criteria_block(fw)
    dialogue = "\n".join(f"[{u.index}] {u.role.upper()}: {u.content}" for u in evidence.units)
    spoken = (voice_transcript or "").strip()
    spoken_note = (
        "The group's spoken discussion below was recorded in the classroom and transcribed; it may be "
        "imperfect and speakers are not identified. "
        + (
            "For THIS approach the spoken discussion is where the community exists: use it as evidence for "
            "criteria about what students say to one another. Tutor moves are evidenced ONLY from the chat."
            if fw.requires_group_talk
            else "Use it only as context for what students said; tutor moves are evidenced ONLY from the chat."
        )
        if spoken
        else ""
    )
    parts = [
        "You are assessing a tutoring dialogue against a teaching approach. Judge ONLY what the dialogue "
        "shows. Do not assume anything about how the tutor was configured or what it intended.",
        f"# Teaching approach: {fw.label}\n\n{' '.join(fw.summary.split())}",
        f"# Criteria\n\n{criteria}",
        "# The dialogue (TUTOR and STUDENT turns, in order; the number is the turn id)\n\n" + dialogue,
    ]
    if spoken:
        parts.append("# The group's spoken discussion (transcript)\n\n" + spoken_note + "\n\n" + spoken)
    parts.append(
        "Return STRICT JSON with exactly this shape:\n"
        "{\n"
        '  "constructs": {<key>: {"band": "absent"|"partial"|"strong", "rationale": "one or two sentences", '
        '"evidence": [<turn ids>]}, ...},\n'
        '  "overall": {"band": "absent"|"partial"|"strong", '
        '"summary": "3-5 plain sentences for a teacher: what this approach looked like in this session and '
        'where it drifted. Refer to the tutor and to the group, never to individual students. No scores, no jargon.", '
        '"drift": ["one line per place the dialogue departed from the approach, or empty"]}\n'
        "}\n"
        f"The construct keys are exactly: {', '.join(keys)}. Every band other than absent must cite at least one "
        "turn id in evidence. If the dialogue is too short to tell, use absent and say so in the rationale."
    )
    return "\n\n".join(parts)


# --- Result ------------------------------------------------------------------------


class FidelityResult(BaseModel):
    """One session's fidelity read against the ONE approach it ran."""

    session_id: str = Field(alias="sessionId")
    framework_id: str | None = Field(default=None, alias="frameworkId")
    framework_label: str | None = Field(default=None, alias="frameworkLabel")
    tutor_id: str | None = Field(default=None, alias="tutorId")
    prompt_version: str = Field(default=PROMPT_VERSION, alias="promptVersion")
    model: str = ""
    abstained: bool = False
    abstain_reason: str = Field(default="", alias="abstainReason")
    #: Teacher-facing prose. Never a number.
    summary: str = ""
    drift: list[str] = Field(default_factory=list)
    overall_band: str | None = Field(default=None, alias="overallBand")
    #: Per-construct detail — researcher-gated at the route.
    constructs: dict[str, dict[str, Any]] = Field(default_factory=dict)
    evidence_summary: dict[str, int] = Field(default_factory=dict, alias="evidenceSummary")
    #: The message count this read was built from — regenerate when it grows.
    based_on_message_count: int = Field(default=0, alias="basedOnMessageCount")
    spoken_included: bool = Field(default=False, alias="spokenIncluded")

    model_config = ConfigDict(populate_by_name=True)

    def teacher_view(self) -> dict[str, Any]:
        """What a teacher sees: prose, drift, the approach's name. No bands."""
        return {
            "frameworkId": self.framework_id,
            "frameworkLabel": self.framework_label,
            "abstained": self.abstained,
            "abstainReason": self.abstain_reason,
            "summary": self.summary,
            "drift": self.drift,
            "spokenIncluded": self.spoken_included,
            "promptVersion": self.prompt_version,
        }

    def researcher_view(self) -> dict[str, Any]:
        return {**self.teacher_view(), **self.model_dump(by_alias=True, mode="json")}


def _abstain(
    summary: SessionSummary, fw: TeachingFramework | None, evidence: DialogueEvidence, reason: str
) -> FidelityResult:
    return FidelityResult(
        sessionId=summary.session_id,
        frameworkId=summary.framework_id,
        frameworkLabel=fw.label if fw else None,
        tutorId=summary.tutor_id,
        abstained=True,
        abstainReason=reason,
        evidenceSummary=evidence.summary,
        basedOnMessageCount=summary.message_count,
    )


def _band(value: Any) -> str:
    v = str(value or "").strip().lower()
    return v if v in BANDS else "absent"


def _parse(raw: str, keys: list[str]) -> dict[str, Any]:
    text = raw.strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        text = m.group(0)
    data = json.loads(text)
    constructs_in = data.get("constructs") or {}
    constructs: dict[str, dict[str, Any]] = {}
    for k in keys:
        c = constructs_in.get(k) or {}
        band = _band(c.get("band"))
        ev = [int(i) for i in (c.get("evidence") or []) if str(i).lstrip("-").isdigit()]
        constructs[k] = {
            "band": band,
            "score": _BAND_SCORE[band],
            "rationale": str(c.get("rationale") or "").strip(),
            "evidence": ev,
        }
    overall = data.get("overall") or {}
    return {
        "constructs": constructs,
        "band": _band(overall.get("band")),
        "summary": str(overall.get("summary") or "").strip(),
        "drift": [str(d).strip() for d in (overall.get("drift") or []) if str(d).strip()],
    }


async def score_fidelity(summary: SessionSummary, *, model: str | None = None) -> FidelityResult:
    """Score one session against the ONE approach it ran. Abstains, never fabricates."""
    evidence = dialogue_units(summary.conversation)
    if not summary.framework_id:
        return _abstain(summary, None, evidence, "this session's tutor did not run a named teaching approach")
    fw = effective_framework(summary.framework_id)
    if fw is None:
        return _abstain(summary, None, evidence, f"unknown teaching approach {summary.framework_id!r}")
    if fw.is_placeholder:
        return _abstain(summary, fw, evidence, f"{fw.label} has no published criteria yet")
    if evidence.tutor_turns < MIN_TUTOR_TURNS:
        return _abstain(
            summary,
            fw,
            evidence,
            f"too little dialogue to assess ({evidence.tutor_turns} tutor turns; need {MIN_TUTOR_TURNS})",
        )
    judge_model = model or default_model()
    provider = provider_for_api_name(judge_model)
    if provider not in (None, "google"):
        return _abstain(summary, fw, evidence, f"judge execution is Gemini-only for now (got {judge_model!r})")

    from analytics.session_rubric import _call_judge_model

    prompt = build_fidelity_prompt(fw, evidence, summary.voice_transcript)
    _, keys = criteria_block(fw)
    raw = await _call_judge_model(prompt, judge_model)
    parsed = _parse(raw, keys)
    logger.info(
        "fidelity: scored session=%s framework=%s band=%s units=%d",
        summary.session_id,
        fw.id,
        parsed["band"],
        len(evidence.units),
    )
    return FidelityResult(
        sessionId=summary.session_id,
        frameworkId=fw.id,
        frameworkLabel=fw.label,
        tutorId=summary.tutor_id,
        model=judge_model,
        summary=parsed["summary"],
        drift=parsed["drift"],
        overallBand=parsed["band"],
        constructs=parsed["constructs"],
        evidenceSummary=evidence.summary,
        basedOnMessageCount=summary.message_count,
        spokenIncluded=bool((summary.voice_transcript or "").strip()),
    )


# --- Store + cache (the RUBRIC-2 run store, unchanged) ---------------------------


def lens_id_for(framework_id: str) -> str:
    return f"fidelity:{framework_id}"


def _to_rubric_result(result: FidelityResult, activity_id: str):
    from analytics.session_rubric import RubricResult

    return RubricResult(
        sessionId=result.session_id,
        activityId=activity_id,
        lensId=lens_id_for(result.framework_id or "none"),
        promptVersion=result.prompt_version,
        model=result.model,
        abstained=result.abstained,
        abstainReason=result.abstain_reason,
        profile=result.model_dump(by_alias=True, mode="json"),
        partitionSummary=result.evidence_summary,
    )


def _from_run_doc(doc: dict[str, Any]) -> FidelityResult | None:
    profile = doc.get("profile") or {}
    if not profile:
        return None
    try:
        return FidelityResult.model_validate(profile)
    except Exception:
        return None


def _cached(session_id: str, framework_id: str | None) -> FidelityResult | None:
    from analytics.rubric_runs import _COLLECTION, _run_id
    from db.firestore import get_document

    doc = get_document(_COLLECTION, _run_id(session_id, lens_id_for(framework_id or "none"), PROMPT_VERSION))
    return _from_run_doc(doc) if doc else None


async def resolve_fidelity(summary: SessionSummary, *, force: bool = False) -> FidelityResult | None:
    """The report's entry point: cached read, regenerated when the session grew
    (or on ``force``). Best-effort — a failure returns ``None`` and the report
    renders without the section, never a broken page."""
    try:
        if not force:
            cached = _cached(summary.session_id, summary.framework_id)
            if cached is not None and cached.based_on_message_count >= summary.message_count:
                return cached
        result = await score_fidelity(summary)
        try:
            from analytics.rubric_runs import record_rubric_run

            record_rubric_run(_to_rubric_result(result, summary.activity_id), group_id=summary.group_code, is_live=True)
        except Exception as exc:
            logger.warning("fidelity: run record failed (suppressed): %s", exc)
        return result
    except Exception as exc:
        logger.warning("fidelity: resolve failed for session=%s (suppressed): %s", summary.session_id, exc)
        return None


__all__ = [
    "BANDS",
    "MIN_TUTOR_TURNS",
    "PROMPT_VERSION",
    "DialogueEvidence",
    "DialogueUnit",
    "FidelityResult",
    "build_fidelity_prompt",
    "criteria_block",
    "dialogue_units",
    "lens_id_for",
    "resolve_fidelity",
    "score_fidelity",
]
