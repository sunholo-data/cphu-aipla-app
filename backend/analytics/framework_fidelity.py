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

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from config.models import analysis_model, provider_for_api_name
from db.framework_overrides import criteria_version, effective_framework
from db.models.teaching_framework import Construct, TeachingFramework
from reports.session_summary import SessionSummary, SessionTurn

logger = logging.getLogger(__name__)

#: r2 (BENCH-2, 2026-09-30): the generic "specific move or at most partial"
#: rule, numbered move ids a ``strong`` band must cite, spoken-counts, and
#: ``assessedIn: unit`` constructs left out of the criteria. The run id carries
#: the version, so stored r1 runs stay attributable and never mix with r2.
#:
#: r3 (1.1.148 M1, 2026-10-05): ONE turn identity. A turn id is the emitter's
#: ``turn_index`` — the ``#N`` the researcher transcript shows — not the turn's
#: 0-based position in the conversation list, which on prod put a cited "43" on
#: transcript #98. Each cited turn carries a verbatim quote, checked server-side;
#: ids outside the scored window are rejected rather than rendered; the drift
#: lines use the same ids; and one turn is not reused across constructs unless
#: it holds a move of each (M0 found turn 43 cited by three of six constructs).
PROMPT_VERSION = "fidelity-r3"

#: How a run's ids are read. ``turn_index`` = the transcript's own number (r3);
#: ``position`` = the 0-based position in the conversation (r3 when the log
#: carries no usable turn_index; every r1/r2 run); ``position-translated`` = a
#: stored position mapped to the transcript number at read time.
ID_TURN_INDEX = "turn_index"
ID_POSITION = "position"
ID_POSITION_TRANSLATED = "position-translated"

#: The longest quote kept per cited turn. The prompt asks for <= 25 words; this
#: bounds what a misbehaving judge can push into the payload.
MAX_QUOTE_CHARS = 300

#: The longest snippet of a cited turn served to the researcher view.
SNIPPET_CHARS = 160

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


def analysis_judge_model() -> str:
    """The judge's default model: the ANALYSIS model, never the tutor's.

    BENCH-1 (2026-09-30): the judge used to run on ``default_model()`` — the
    same flash-lite the tutor it judges runs on. Judging is after-the-fact batch
    work, so it moves to ``config.models.analysis_model()``. A named function
    rather than a bare import so the fit-all profile and the benchmark share
    one answer to "what does the judge run on".
    """
    return analysis_model()


# --- M0: dialogue-unit evidence -------------------------------------------------


@dataclass(frozen=True)
class DialogueUnit:
    #: The id the judge cites: the turn's ``turn_index`` (r3), else its position.
    index: int
    role: str  # "tutor" | "student"
    content: str
    #: 0-based position in ``SessionSummary.conversation`` — kept so a citation
    #: can always be resolved back to the turn, whatever ``index`` is.
    position: int = -1


@dataclass
class DialogueEvidence:
    """Ordered tutor+student turns — the evidence rule that INCLUDES the tutor.

    ``summary`` rides the result so a researcher can audit what was scored,
    exactly as ``EvidencePartition.summary`` does for the competency lenses.
    """

    units: list[DialogueUnit] = field(default_factory=list)
    truncated_from: int | None = None
    #: :data:`ID_TURN_INDEX` or :data:`ID_POSITION` — what ``DialogueUnit.index`` is.
    id_scheme: str = ID_POSITION

    @property
    def tutor_turns(self) -> int:
        return sum(1 for u in self.units if u.role == "tutor")

    @property
    def student_turns(self) -> int:
        return sum(1 for u in self.units if u.role == "student")

    @property
    def summary(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "units": len(self.units),
            "tutor": self.tutor_turns,
            "student": self.student_turns,
            "idScheme": self.id_scheme,
        }
        if self.truncated_from is not None:
            out["truncated_from"] = self.truncated_from
        return out

    def by_id(self) -> dict[int, DialogueUnit]:
        return {u.index: u for u in self.units}


def _usable_turn_indexes(turns: list[SessionTurn]) -> bool:
    """True when every turn carries a ``turn_index`` and no two share one.

    A duplicate would make a cited id ambiguous (two transcript rows ``#N``),
    and a gap would leave a turn with no id — either way the honest fallback is
    position for the whole session, flagged as such (M0 Q4: the ordering hazard).
    """
    seen: set[int] = set()
    for t in turns:
        ti = getattr(t, "turn_index", None)
        if ti is None or ti in seen:
            return False
        seen.add(ti)
    return bool(turns)


def dialogue_units(turns: list[SessionTurn], *, max_turns: int = MAX_TURNS) -> DialogueEvidence:
    """The ordered dialogue, turn ids preserved, tutor turns INCLUDED.

    Deliberately not ``session_rubric.partition_evidence``: that rule discards
    the tutor, and the tutor is what this instrument measures.
    """
    total = len(turns)
    window = turns[-max_turns:] if total > max_turns else turns
    offset = total - len(window)
    by_turn_index = _usable_turn_indexes(turns)
    units = [
        DialogueUnit(
            index=t.turn_index if by_turn_index and t.turn_index is not None else offset + i,
            role=t.role,
            content=(t.content or "").strip(),
            position=offset + i,
        )
        for i, t in enumerate(window)
        if (t.content or "").strip()
    ]
    return DialogueEvidence(
        units=units,
        truncated_from=total if total > max_turns else None,
        id_scheme=ID_TURN_INDEX if by_turn_index else ID_POSITION,
    )


# --- The criteria, generated from the framework ---------------------------------


def _construct_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")


def move_id(key: str, n: int) -> str:
    """The id a judge cites for a construct's n-th listed move (1-based)."""
    return f"{key}.{n}"


def assessed_constructs(fw: TeachingFramework) -> list[Construct]:
    """The constructs the judge scores: every one a dialogue can show.

    ``assessedIn: unit`` constructs are left out — see :func:`not_assessed`.
    """
    return [c for c in fw.constructs if c.assessed_in == "dialogue"]


_UNIT_REASON = "a strategy run across a teaching unit; a single tutoring dialogue has no occasion to show it"


def not_assessed(fw: TeachingFramework) -> dict[str, str]:
    """Construct key → why the judge does not score it. Explicit, never a silent 0."""
    return {_construct_key(c.name): _UNIT_REASON for c in fw.constructs if c.assessed_in == "unit"}


def criteria_block(fw: TeachingFramework) -> tuple[str, list[str]]:
    """Render the framework's constructs as scoring criteria.

    Returns the text and the ordered construct keys the judge must answer for.
    Everything here is the YAML read back: behaviours are what to look FOR,
    ``avoid`` is what counts AGAINST, the evaluation hint is the construct's
    own question. Nothing is paraphrased, so a reader can hold the judge's
    criteria against the published framework page line by line.

    r2: each move carries an id (``<key>.<n>``) that a ``strong`` band must
    cite, and ``assessedIn: unit`` constructs are omitted — the judge is never
    asked about what a dialogue cannot show (:func:`not_assessed` names them).
    """
    keys: list[str] = []
    lines: list[str] = []
    for c in assessed_constructs(fw):
        key = _construct_key(c.name)
        keys.append(key)
        lines.append(f"### {key}")
        if c.summary:
            lines.append(" ".join(c.summary.split()))
        if c.behaviours:
            lines.append("Moves that show it (cite the id):")
            lines += [f"- [{move_id(key, i)}] {b.text}" for i, b in enumerate(c.behaviours, 1)]
        if c.avoid:
            lines.append("Counts against it:")
            lines += [f"- {a}" for a in c.avoid]
        if c.evaluation_hint:
            lines.append("Question to answer: " + " ".join(c.evaluation_hint.split()))
        lines.append("")
    return "\n".join(lines).strip(), keys


def criteria_detail(fw: TeachingFramework) -> dict[str, dict[str, Any]]:
    """The criteria the judge was given, per construct, as data (1.1.148 M2).

    The same fields :func:`criteria_block` renders into the prompt, with the
    same move ids — so the researcher reading the construct table sees exactly
    what the judge was asked, and can tell which listed move a band cited.
    """
    out: dict[str, dict[str, Any]] = {}
    for c in assessed_constructs(fw):
        key = _construct_key(c.name)
        out[key] = {
            "name": c.name,
            "summary": " ".join((c.summary or "").split()),
            "moves": [{"id": move_id(key, i), "text": b.text} for i, b in enumerate(c.behaviours, 1)],
            "avoid": list(c.avoid or []),
            "evaluationHint": " ".join((c.evaluation_hint or "").split()),
        }
    return out


def move_counts(fw: TeachingFramework) -> dict[str, int]:
    """Construct key → number of listed moves, for range-checking cited move ids."""
    return {_construct_key(c.name): len(c.behaviours) for c in assessed_constructs(fw)}


#: The generic banding rule (BENCH-2). Applies to every approach, because the
#: failure it answers is not ESRU's alone: BENCH-1 found ESRU's column at
#: 0.88-1.00 for transcripts from all seven tutors — the judge credited ordinary
#: good questioning as ESRU. A construct is "strong" only on the move SPECIFIC to
#: it; what any competent tutor does anyway is at most partial. The parser
#: enforces the half it can check (a strong band must cite one of its own
#: construct's move ids) — see ``_parse``.
BANDING_RULE = (
    "# How to band each construct\n\n"
    "- strong: the dialogue shows a move DISTINCTIVE of this construct — one of its listed moves, done the way "
    'the construct describes. Cite that move\'s id in "moves" and the turn(s) in "evidence".\n'
    "- partial: the construct's intent shows only in behaviour any competent questioning tutor shows whatever its "
    "approach (asking an open question, acknowledging or praising an answer, following up with another question, "
    "explaining the physics); OR a distinctive move is attempted but incomplete; OR it is undercut by a "
    '"Counts against it" move in the same turn.\n'
    "- absent: neither.\n\n"
    "Before choosing strong, ask: would a capable tutor following NO particular teaching approach have written "
    "this turn anyway? If yes, it is not strong. A strong band that cites no move id of its own construct is "
    "read as partial.\n\n"
    "Cite, for each construct, the turn(s) where THAT construct's move happens. Do not cite one turn for several "
    "constructs unless that turn really contains a move of each.\n\n"
    "This is a chat dialogue. A claim, prediction, piece of evidence, reason or explanation SAID in a turn counts; "
    "nothing has to be written down or formally structured. Do not mark a construct absent only because no "
    "written product exists."
)


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
        BANDING_RULE,
        "# The dialogue (TUTOR and STUDENT turns, in order; the number in brackets is the turn id. Ids are "
        "not consecutive: use them exactly as written)\n\n" + dialogue,
    ]
    if spoken:
        parts.append("# The group's spoken discussion (transcript)\n\n" + spoken_note + "\n\n" + spoken)
    parts.append(
        "Return STRICT JSON with exactly this shape:\n"
        "{\n"
        '  "constructs": {<key>: {"band": "absent"|"partial"|"strong", '
        '"rationale": "one or two sentences naming the move you saw", '
        '"moves": [<move ids from the criteria, e.g. "<key>.2">], '
        '"evidence": [{"turn": <turn id>, "quote": "<up to 25 words copied exactly from that turn>"}]}, ...},\n'
        '  "overall": {"band": "absent"|"partial"|"strong", '
        '"summary": "3-5 plain sentences for a teacher: what this approach looked like in this session and '
        'where it drifted. Refer to the tutor and to the group, never to individual students. No scores, no jargon.", '
        '"drift": ["one line per place the dialogue departed from the approach, naming turns as #<turn id>, '
        'or empty"]}\n'
        "}\n"
        f"The construct keys are exactly: {', '.join(keys)}. Every band other than absent must cite at least one "
        "turn in evidence, by a turn id that appears in the dialogue above, with a quote copied word for word from "
        "that turn. If the dialogue is too short to tell, use absent and say so in the rationale."
    )
    return "\n\n".join(parts)


# --- Result ------------------------------------------------------------------------


def rubric_version_for(prompt_version: str, criteria_ver: str | None) -> str:
    """The run's version string (1.1.148 M5): ``fidelity-r3+fw<criteria version>``.

    The criteria edition rides the run id, so a researcher's edit to a
    framework's constructs produces a NEW run beside the old one — and the old
    run can still say which criteria it was judged against. A run from before
    r3 carries no criteria version and keeps its bare prompt version, so its id
    is unchanged.
    """
    return f"{prompt_version}+fw{criteria_ver}" if criteria_ver else prompt_version


class FidelityResult(BaseModel):
    """One session's fidelity read against the ONE approach it ran."""

    session_id: str = Field(alias="sessionId")
    framework_id: str | None = Field(default=None, alias="frameworkId")
    framework_label: str | None = Field(default=None, alias="frameworkLabel")
    tutor_id: str | None = Field(default=None, alias="tutorId")
    prompt_version: str = Field(default=PROMPT_VERSION, alias="promptVersion")
    #: The criteria edition the judge was given (:func:`criteria_version`) —
    #: ``"yaml"``, a stored version number, or None on a pre-r3 run.
    criteria_version: str | None = Field(default=None, alias="criteriaVersion")
    model: str = ""
    abstained: bool = False
    abstain_reason: str = Field(default="", alias="abstainReason")
    #: Teacher-facing prose. Never a number.
    summary: str = ""
    drift: list[str] = Field(default_factory=list)
    overall_band: str | None = Field(default=None, alias="overallBand")
    #: Per-construct detail — researcher-gated at the route.
    constructs: dict[str, dict[str, Any]] = Field(default_factory=dict)
    #: Constructs the judge was NOT asked about (``assessedIn: unit``), key →
    #: reason. Named rather than scored 0, so absence of a unit-scale strategy
    #: never reads as the tutor failing at it (BENCH-2).
    not_assessed: dict[str, str] = Field(default_factory=dict, alias="notAssessed")
    evidence_summary: dict[str, Any] = Field(default_factory=dict, alias="evidenceSummary")
    #: The message count this read was built from — regenerate when it grows.
    based_on_message_count: int = Field(default=0, alias="basedOnMessageCount")
    spoken_included: bool = Field(default=False, alias="spokenIncluded")
    #: When the judge ran (ISO 8601) — the re-score debounce reads it, and the
    #: researcher's run history shows it. Absent on runs before 1.1.148.
    scored_at: str | None = Field(default=None, alias="scoredAt")

    model_config = ConfigDict(populate_by_name=True)

    @property
    def rubric_version(self) -> str:
        return rubric_version_for(self.prompt_version, self.criteria_version)

    @property
    def run_id(self) -> str:
        from analytics.rubric_runs import _run_id

        return _run_id(self.session_id, lens_id_for(self.framework_id or "none"), self.rubric_version)

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

    def researcher_view(self, conversation: list[SessionTurn] | None = None) -> dict[str, Any]:
        """Everything, for a researcher. With ``conversation`` (the session the
        run judged), every cited turn is resolved to the transcript's own number
        and a snippet of what was said (:func:`present_constructs`)."""
        data = {**self.teacher_view(), **self.model_dump(by_alias=True, mode="json")}
        data["rubricVersion"] = self.rubric_version
        data["runId"] = self.run_id
        if conversation is not None:
            data["constructs"], data["idScheme"] = present_constructs(self, conversation)
        return data


# --- Presenting a citation (1.1.148 M1/M2) ----------------------------------------


def _norm(text: str) -> str:
    return " ".join((text or "").split()).casefold()


_ELLIPSIS = re.compile(r"\.\.\.|…")
_QUOTE_MARKS = "\"'\u201c\u201d\u201e\u00ab\u00bb\u2018\u2019 "


def quote_verified(quote: str | None, content: str) -> bool:
    """True iff ``quote`` is really in ``content``: a whitespace- and
    case-normalised substring. An elision (``...`` / ``…``) splits the quote,
    and every fragment must appear, in order. Surrounding quote marks are not
    part of the quote. An empty quote verifies nothing."""
    q = (quote or "").strip().strip(_QUOTE_MARKS)
    if not q:
        return False
    hay = _norm(content)
    at = 0
    fragments = [_norm(f).strip(_QUOTE_MARKS) for f in _ELLIPSIS.split(q)]
    fragments = [f for f in fragments if f]
    if not fragments:
        return False
    for frag in fragments:
        found = hay.find(frag, at)
        if found < 0:
            return False
        at = found + len(frag)
    return True


def _parse_evidence(items: Any, evidence: DialogueEvidence | None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The judge's citations → kept + rejected.

    Accepts the r3 shape (``{"turn": id, "quote": "..."}``) and a bare id (r2,
    or a judge that ignored the shape). With the scored ``evidence`` in hand an
    id that is not a turn of the scored window is REJECTED — never rendered as
    a link to a turn the judge did not see — and each quote is verified against
    the turn it names.
    """
    by_id = evidence.by_id() if evidence is not None else None
    kept: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    seen: set[int] = set()
    for it in items if isinstance(items, list) else []:
        raw_turn, quote = (it.get("turn", it.get("id")), it.get("quote")) if isinstance(it, dict) else (it, None)
        q = str(quote).strip()[:MAX_QUOTE_CHARS] if quote not in (None, "") else None
        s = str(raw_turn if raw_turn is not None else "").strip().lstrip("#")
        if not s.lstrip("-").isdigit():
            rejected.append({"turn": str(raw_turn), "quote": q, "reason": "not a turn id"})
            continue
        turn = int(s)
        if by_id is not None and turn not in by_id:
            rejected.append({"turn": turn, "quote": q, "reason": "not a turn of the scored dialogue"})
            continue
        if turn in seen:
            continue
        seen.add(turn)
        entry: dict[str, Any] = {"turn": turn}
        if q is not None:
            entry["quote"] = q
        if by_id is not None:
            unit = by_id[turn]
            entry["role"] = unit.role
            entry["verified"] = quote_verified(q, unit.content)
        kept.append(entry)
    return kept, rejected


def present_constructs(
    result: FidelityResult, conversation: list[SessionTurn]
) -> tuple[dict[str, dict[str, Any]], str]:
    """Resolve every cited turn to the transcript the researcher reads.

    Each evidence entry comes back as ``{turn, transcriptTurn, position, role,
    snippet, quote?, verified?}``: ``turn`` is the id as the judge gave it,
    ``transcriptTurn`` the ``#N`` the transcript shows (None when there is no
    honest answer — then the UI renders no link), ``snippet`` the start of
    what was said there.

    The scheme is read off the run: an r3 run says ``idScheme``; a run without
    one (r1/r2) cited 0-based POSITIONS, which are translated here — once, at
    read time, deterministically (the conversation is append-only and
    BigQuery-ordered) — and labelled ``position-translated``. No stored run is
    rewritten. An id that resolves to no turn moves to ``rejectedEvidence``.
    """
    scheme = str((result.evidence_summary or {}).get("idScheme") or ID_POSITION)
    usable = _usable_turn_indexes(conversation)
    by_turn_index = {t.turn_index: p for p, t in enumerate(conversation)} if usable else {}
    out_scheme = scheme
    if scheme == ID_POSITION and usable:
        out_scheme = ID_POSITION_TRANSLATED

    def _resolve(turn: int) -> int | None:
        if scheme == ID_TURN_INDEX:
            return by_turn_index.get(turn)
        return turn if 0 <= turn < len(conversation) else None

    def _transcript_turn(pos: int) -> int | None:
        if usable:
            return conversation[pos].turn_index
        # No usable turn_index anywhere: the fallback transcript numbers by
        # position, so position IS its number. Mixed/duplicated: no honest link.
        return pos if all(t.turn_index is None for t in conversation) else None

    presented: dict[str, dict[str, Any]] = {}
    for key, c in (result.constructs or {}).items():
        entry = dict(c)
        kept: list[dict[str, Any]] = []
        rejected = list(c.get("rejectedEvidence") or [])
        for ev in c.get("evidence") or []:
            item = dict(ev) if isinstance(ev, dict) else {"turn": ev}
            try:
                turn = int(item.get("turn"))
            except (TypeError, ValueError):
                rejected.append({**item, "reason": "not a turn id"})
                continue
            pos = _resolve(turn)
            if pos is None:
                rejected.append({**item, "reason": "not a turn of this session"})
                continue
            t = conversation[pos]
            text = " ".join((t.content or "").split())
            item.update(
                {
                    "turn": turn,
                    "position": pos,
                    "transcriptTurn": _transcript_turn(pos),
                    "role": item.get("role") or t.role,
                    "snippet": text[:SNIPPET_CHARS] + ("…" if len(text) > SNIPPET_CHARS else ""),
                }
            )
            kept.append(item)
        entry["evidence"] = kept
        if rejected:
            entry["rejectedEvidence"] = rejected
        presented[key] = entry
    return presented, out_scheme


def _abstain(
    summary: SessionSummary,
    fw: TeachingFramework | None,
    evidence: DialogueEvidence,
    reason: str,
    criteria_ver: str | None = None,
) -> FidelityResult:
    return FidelityResult(
        sessionId=summary.session_id,
        frameworkId=summary.framework_id,
        frameworkLabel=fw.label if fw else None,
        tutorId=summary.tutor_id,
        criteriaVersion=criteria_ver,
        abstained=True,
        abstainReason=reason,
        evidenceSummary=evidence.summary,
        basedOnMessageCount=summary.message_count,
        scoredAt=_now_iso(),
    )


def _now_iso() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat()


def _band(value: Any) -> str:
    v = str(value or "").strip().lower()
    return v if v in BANDS else "absent"


def _own_moves(key: str, cited: Any, count: int | None) -> list[str]:
    """The cited move ids that really belong to construct ``key``.

    An id is ``<key>.<n>``, n ≥ 1 — and ≤ the construct's move count when the
    caller knows it. A move of ANOTHER construct does not earn this one a strong.
    """
    out: list[str] = []
    for m in cited if isinstance(cited, list) else []:
        s = str(m).strip()
        head, _, n = s.rpartition(".")
        if head == key and n.isdigit() and int(n) >= 1 and (count is None or int(n) <= count):
            out.append(s)
    return out


def _parse(
    raw: str,
    keys: list[str],
    moves: dict[str, int] | None = None,
    evidence: DialogueEvidence | None = None,
) -> dict[str, Any]:
    """Parse the judge's JSON into bands + 0-2 scores per construct. Public as
    :func:`parse_judgement` for the fit-against-all profile (1.1.107 M2).

    r2 enforces the half of :data:`BANDING_RULE` that is checkable: a ``strong``
    band that cites no valid move id of its OWN construct is downgraded to
    ``partial`` and marked ``downgraded``. ``moves`` (key → move count, from
    :func:`move_counts`) adds a range check; without it the id shape is still
    checked, so callers on the two-argument form get the rule too.

    r3 (1.1.148): ``evidence`` is a list of ``{"turn", "quote", ...}``. Given
    the scored dialogue, ids outside it go to ``rejectedEvidence`` and each
    quote is marked ``verified`` (:func:`_parse_evidence`).
    """
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
        ev, rejected = _parse_evidence(c.get("evidence"), evidence)
        cited = _own_moves(k, c.get("moves"), (moves or {}).get(k))
        entry: dict[str, Any] = {}
        if band == "strong" and not cited:
            band = "partial"
            entry["downgraded"] = "strong without a move of its own construct"
        if rejected:
            entry["rejectedEvidence"] = rejected
        constructs[k] = {
            "band": band,
            "score": _BAND_SCORE[band],
            "rationale": str(c.get("rationale") or "").strip(),
            "moves": cited,
            "evidence": ev,
            **entry,
        }
    overall = data.get("overall") or {}
    return {
        "constructs": constructs,
        "band": _band(overall.get("band")),
        "summary": str(overall.get("summary") or "").strip(),
        "drift": [str(d).strip() for d in (overall.get("drift") or []) if str(d).strip()],
    }


parse_judgement = _parse


async def score_fidelity(summary: SessionSummary, *, model: str | None = None) -> FidelityResult:
    """Score one session against the ONE approach it ran. Abstains, never fabricates."""
    evidence = dialogue_units(summary.conversation)
    cv = criteria_version(summary.framework_id)
    if not summary.framework_id:
        return _abstain(summary, None, evidence, "this session's tutor did not run a named teaching approach", cv)
    fw = effective_framework(summary.framework_id)
    if fw is None:
        return _abstain(summary, None, evidence, f"unknown teaching approach {summary.framework_id!r}", cv)
    if fw.is_placeholder:
        return _abstain(summary, fw, evidence, f"{fw.label} has no published criteria yet", cv)
    if evidence.tutor_turns < MIN_TUTOR_TURNS:
        return _abstain(
            summary,
            fw,
            evidence,
            f"too little dialogue to assess ({evidence.tutor_turns} tutor turns; need {MIN_TUTOR_TURNS})",
            cv,
        )
    if not assessed_constructs(fw):
        return _abstain(summary, fw, evidence, f"{fw.label} has no construct a single tutoring dialogue can show", cv)
    judge_model = model or analysis_judge_model()
    provider = provider_for_api_name(judge_model)
    if provider not in (None, "google"):
        return _abstain(summary, fw, evidence, f"judge execution is Gemini-only for now (got {judge_model!r})", cv)

    from analytics.session_rubric import _call_judge_model

    prompt = build_fidelity_prompt(fw, evidence, summary.voice_transcript)
    _, keys = criteria_block(fw)
    raw = await _call_judge_model(prompt, judge_model)
    parsed = _parse(raw, keys, move_counts(fw), evidence)
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
        criteriaVersion=cv,
        model=judge_model,
        summary=parsed["summary"],
        drift=parsed["drift"],
        overallBand=parsed["band"],
        constructs=parsed["constructs"],
        notAssessed=not_assessed(fw),
        evidenceSummary=evidence.summary,
        basedOnMessageCount=summary.message_count,
        spokenIncluded=bool((summary.voice_transcript or "").strip()),
        scoredAt=_now_iso(),
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
        promptVersion=result.rubric_version,
        model=result.model,
        abstained=result.abstained,
        abstainReason=result.abstain_reason,
        profile=result.model_dump(by_alias=True, mode="json"),
        # The run store's summary is counts only; the id scheme rides the profile.
        partitionSummary={k: v for k, v in result.evidence_summary.items() if isinstance(v, int)},
        frameworkId=result.framework_id,
        tutorId=result.tutor_id,
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
    """The stored run for the CURRENT prompt and criteria edition, or None.

    1.1.148 M5: the criteria version is computed before the lookup, so after a
    framework edit this misses honestly and the next read judges again, against
    the criteria as they now stand. The older run stays in the store.
    """
    from analytics.rubric_runs import _COLLECTION, _run_id
    from db.firestore import get_document

    version = rubric_version_for(PROMPT_VERSION, criteria_version(framework_id))
    doc = get_document(_COLLECTION, _run_id(session_id, lens_id_for(framework_id or "none"), version))
    return _from_run_doc(doc) if doc else None


#: A grown session is re-judged at most this often, unless forced. M0 found one
#: session judged three times inside a minute while its report was open — every
#: 12-second poll of a live session saw a larger message count and paid for a
#: new judgement, each with different evidence, and only the last was kept. The
#: narrative already had this window (``reports.narrative._DEBOUNCE_MINUTES``).
RESCORE_MIN_INTERVAL_S = 300


def _recently_scored(result: FidelityResult) -> bool:
    from datetime import UTC, datetime

    if not result.scored_at:
        return False
    try:
        at = datetime.fromisoformat(result.scored_at)
    except ValueError:
        return False
    if at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    return (datetime.now(UTC) - at).total_seconds() < RESCORE_MIN_INTERVAL_S


#: One judgement in flight per (loop, session, framework): concurrent report
#: reads of one session share it instead of each paying for its own.
_INFLIGHT: dict[tuple[int, str, str], asyncio.Future[FidelityResult]] = {}


async def _score_and_record(summary: SessionSummary) -> FidelityResult:
    result = await score_fidelity(summary)
    try:
        from analytics.rubric_runs import record_rubric_run

        record_rubric_run(_to_rubric_result(result, summary.activity_id), group_id=summary.group_code, is_live=True)
    except Exception as exc:
        logger.warning("fidelity: run record failed (suppressed): %s", exc)
    return result


async def resolve_fidelity(summary: SessionSummary, *, force: bool = False) -> FidelityResult | None:
    """The report's entry point: cached read, regenerated when the session grew
    (no more often than :data:`RESCORE_MIN_INTERVAL_S`) or on ``force``.
    Best-effort — a failure returns ``None`` and the report renders without the
    section, never a broken page."""
    try:
        if not force:
            cached = _cached(summary.session_id, summary.framework_id)
            if cached is not None and (
                cached.based_on_message_count >= summary.message_count or _recently_scored(cached)
            ):
                return cached
        key = (id(asyncio.get_running_loop()), summary.session_id, summary.framework_id or "")
        task = _INFLIGHT.get(key)
        if task is None:
            task = asyncio.ensure_future(_score_and_record(summary))
            _INFLIGHT[key] = task
            task.add_done_callback(lambda _t: _INFLIGHT.pop(key, None))
        return await asyncio.shield(task)
    except Exception as exc:
        logger.warning("fidelity: resolve failed for session=%s (suppressed): %s", summary.session_id, exc)
        return None


# --- What the researcher is shown beside the bands (1.1.148 M2/M5) ------------------


def researcher_payload(result: FidelityResult, summary: SessionSummary) -> dict[str, Any]:
    """The researcher view plus what it takes to read it: the criteria as the
    judge was given them (served from the framework as it stands now, flagged
    when the run was judged against an earlier edition) and the cited turns
    resolved to the transcript. Synchronous Firestore — call off the loop."""
    data = result.researcher_view(summary.conversation)
    current = criteria_version(result.framework_id)
    data["currentCriteriaVersion"] = current
    data["criteriaChanged"] = bool(result.criteria_version) and result.criteria_version != current
    data["sessionMessageCount"] = summary.message_count
    fw = effective_framework(result.framework_id) if result.framework_id else None
    data["criteria"] = criteria_detail(fw) if fw is not None else {}
    return data


def fidelity_run_history(session_id: str, conversation: list[SessionTurn] | None = None) -> dict[str, Any]:
    """Every fidelity judgement of one session, for the researcher to compare.

    Two sources, kept apart (the "a checker answers when it could not read its
    subject" footgun): ``stored`` is the Firestore run store — ONE row per
    prompt+criteria version, overwritten on each re-score; ``emissions`` is the
    BigQuery mirror, which keeps EVERY judgement. ``emissionsStatus`` says
    whether the mirror could be read at all — "unreadable" is never "no runs".
    Synchronous Firestore + BigQuery — call through ``asyncio.to_thread``.
    """
    from analytics.rubric_runs import _COLLECTION
    from db.firestore import query_documents

    def _row(profile: dict[str, Any], *, run_id: str, version: str, at: str | None, source: str) -> dict[str, Any]:
        res = _from_run_doc({"profile": profile})
        if res is None:
            return {"runId": run_id, "rubricVersion": version, "scoredAt": at, "source": source, "unreadable": True}
        constructs, scheme = (
            present_constructs(res, conversation) if conversation is not None else (res.constructs, None)
        )
        return {
            "runId": run_id,
            "rubricVersion": version,
            "promptVersion": res.prompt_version,
            "criteriaVersion": res.criteria_version,
            "scoredAt": res.scored_at or at,
            "model": res.model,
            "abstained": res.abstained,
            "abstainReason": res.abstain_reason,
            "overallBand": res.overall_band,
            "constructs": constructs,
            "idScheme": scheme,
            "basedOnMessageCount": res.based_on_message_count,
            "source": source,
        }

    stored: list[dict[str, Any]] = []
    for doc in query_documents(_COLLECTION, filters=[("session_id", "==", session_id)]) or []:
        if not str(doc.get("rubric_id") or "").startswith("fidelity:"):
            continue
        stored.append(
            _row(
                doc.get("profile") or {},
                run_id=str(doc.get("run_id") or doc.get("__id") or ""),
                version=str(doc.get("rubric_version") or ""),
                at=doc.get("created_at"),
                source="store",
            )
        )
    stored.sort(key=lambda r: r.get("scoredAt") or "", reverse=True)

    emissions: list[dict[str, Any]] = []
    status = "ok"
    try:
        from db.bigquery import RUBRIC_RUN_TABLE, run_query, table_ref

        rows = run_query(
            "SELECT timestamp AS ts, jsonPayload.run_id AS run_id, jsonPayload.rubric_version AS v, "
            "jsonPayload.profile_json AS p "
            f"FROM {table_ref(RUBRIC_RUN_TABLE)} "
            "WHERE jsonPayload.session_id = @session_id AND STARTS_WITH(jsonPayload.rubric_id, 'fidelity:') "
            "ORDER BY timestamp DESC LIMIT 50",
            params={"session_id": session_id},
        )
        for r in rows:
            try:
                profile = json.loads(r["p"] or "{}")
            except (TypeError, ValueError):
                profile = {}
            ts = r["ts"]
            emissions.append(
                _row(
                    profile,
                    run_id=str(r["run_id"] or ""),
                    version=str(r["v"] or ""),
                    at=ts.isoformat() if hasattr(ts, "isoformat") else (str(ts) if ts else None),
                    source="log",
                )
            )
    except Exception as exc:
        logger.warning("fidelity history: BigQuery mirror unreadable for session=%s: %s", session_id, exc)
        status = "unreadable"
    return {"sessionId": session_id, "stored": stored, "emissions": emissions, "emissionsStatus": status}


__all__ = [
    "BANDING_RULE",
    "BANDS",
    "ID_POSITION",
    "ID_POSITION_TRANSLATED",
    "ID_TURN_INDEX",
    "MIN_TUTOR_TURNS",
    "PROMPT_VERSION",
    "RESCORE_MIN_INTERVAL_S",
    "DialogueEvidence",
    "DialogueUnit",
    "FidelityResult",
    "analysis_judge_model",
    "assessed_constructs",
    "build_fidelity_prompt",
    "criteria_block",
    "criteria_detail",
    "dialogue_units",
    "fidelity_run_history",
    "lens_id_for",
    "move_counts",
    "move_id",
    "not_assessed",
    "parse_judgement",
    "present_constructs",
    "quote_verified",
    "researcher_payload",
    "resolve_fidelity",
    "rubric_version_for",
    "score_fidelity",
]
