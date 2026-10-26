"""AI narrative summary for the teacher session report (sprint 1.1.4).

Turns a :class:`reports.session_summary.SessionSummary` into a short,
teacher-facing narrative — the *prominent* artefact on the report page,
with the raw transcript collapsed behind a toggle. Strategically this is
also the privacy-forward shape for eventual audio inclusion (a summary
has a lower privacy profile than verbatim speech).

Generated **on-demand** when a teacher opens the report and cached on the
``ChatSessionIndex`` row (``summary_text`` / ``summary_generated_at`` /
``summary_based_on_turn_count``). Regenerated only when the live message
count exceeds the count the cached summary was built from, so re-opening a
finished session is free.

The prompt is grounded: sim parameters come from the workbench-event
stream, never invented; students are referred to as "the group", never
individually; no verbatim quoting; no emoji.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from config.models import analysis_model
from db.chat_sessions import get_session_index, update_session_fields
from reports.session_summary import SessionSummary

log = logging.getLogger(__name__)

#: Model is config-driven — config/models.yaml ``analysis_model`` (BENCH-1,
#: 1.1.139 D1). The narrative is after-the-fact (a report read after the lesson,
#: pre-warmed by the internal warm route), so it runs on the analysis model,
#: not the tutor's lite model.

_SYSTEM_PROMPT = """\
You are summarising a tutoring session for a teacher reviewing what happened.
Produce these sections, in order, as Markdown — no preamble, no emoji:

**Narrative** (4-6 sentences, past tense): What did the group explore? What was
their approach? Where did they get stuck? Reflect what they actually discussed
aloud, not only the tutor exchange.

**Concepts & topics discussed** (4-8 bullets): the physics concepts AND the main
discussion threads — including notable tangents or off-topic drift (e.g. if they
wandered to a related idea) — drawn from both the chat and the spoken discussion.

**Sim parameters explored** (bullets): which workbench parameters the group
actually varied. Use ONLY the parameters listed in the data below — do not
invent values. Omit this section if there were no workbench events.

**Checklist progress** (one line): include only if the data shows checklist
progress; otherwise omit.

**Next time** (one sentence): what this group most needs next session.

The spoken discussion below is the richest record of how the group reasoned aloud —
give it **at least equal weight** to the chat, and reflect what they genuinely talked
about, including digressions. It may be imperfect, so don't over-quote it.

Refer to "the group" or "the students" — never to individuals. Do not quote
students verbatim. Maximum ~400 words.
"""


def build_narrative_prompt(summary: SessionSummary) -> str:
    """Assemble the grounded prompt from the conversation + workbench events."""
    convo_lines = [
        f"[t{t.turn_index} {t.role}] {t.content}" if t.turn_index is not None else f"[{t.role}] {t.content}"
        for t in summary.conversation
    ]
    convo = "\n".join(convo_lines) if convo_lines else "(no messages)"
    if summary.workbench_events:
        wb = "\n".join(f"- {e.server}.{e.tool} {e.field}={e.value}" for e in summary.workbench_events)
    else:
        wb = "(no workbench events)"
    spoken = (summary.voice_transcript or "").strip()
    spoken_block = spoken if spoken else "(no recorded discussion)"
    return (
        f"{_SYSTEM_PROMPT}\n\n"
        f"Activity: {summary.activity_id}\n"
        f"Duration: {summary.duration_seconds // 60} min · "
        f"{summary.message_count} messages · {summary.sim_run_count} sim runs\n\n"
        f"Chat with the tutor (what the group typed):\n{convo}\n\n"
        f"Spoken group discussion (audio transcript — may be imperfect):\n{spoken_block}\n\n"
        f"Workbench events:\n{wb}\n"
    )


#: Don't regenerate the narrative more than once per this window — a cost guard on
#: a teacher refreshing a live lesson's report (1.1.36 A2).
_DEBOUNCE_MINUTES = 5


def _within_debounce(generated_at) -> bool:
    """True if the cached summary was generated within the debounce window, so a
    grown-but-recently-generated session serves the cache instead of re-running."""
    if not generated_at:
        return False
    try:
        ts = generated_at if isinstance(generated_at, datetime) else datetime.fromisoformat(str(generated_at))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=UTC)
        return (datetime.now(UTC) - ts) < timedelta(minutes=_DEBOUNCE_MINUTES)
    except (ValueError, TypeError):
        return False


# --- 1.1.139 M0: concepts as data, from the SAME call --------------------------

#: Bump when the concept extraction's prompt or schema changes — the lesson
#: roll-up treats a session whose cache doc carries another version as "concepts
#: not extracted yet" (and the backfill re-runs it).
CONCEPTS_VERSION = "concepts-v1"

#: What the model may say about a concept. ``demonstrated`` is deliberately NOT
#: here: "got it" is the tutor's evidence record (1.1.134 ``mark_concept`` /
#: checkpoint), never the summariser's opinion. It is added afterwards, from
#: that record only (:func:`finalise_concepts`).
MODEL_STATUSES = ("discussed", "struggled")
CONCEPT_STATUSES = ("discussed", "struggled", "demonstrated")
MAX_CONCEPTS = 10


@dataclass
class ConceptVocabulary:
    """The closed vocabulary for one session: the activity's concept-map nodes
    (empty when the activity has no map — the model then returns free labels)
    and the node ids the TUTOR has recorded as demonstrated for this group."""

    nodes: list[dict[str, str]] = field(default_factory=list)  # [{"id", "label"}]
    demonstrated: set[str] = field(default_factory=set)

    @property
    def closed(self) -> bool:
        return bool(self.nodes)


@dataclass
class NarrativeResult:
    text: str
    #: None = the call did not return structured concepts (unparseable, or a
    #: plain-text reply) — "not extracted", never "no concepts".
    concepts: list[dict[str, Any]] | None = None


#: Gemini ``response_schema`` for the one call: the Markdown narrative (exactly
#: what the report rendered before M0) plus the structured concepts.
NARRATIVE_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "narrative": {"type": "STRING"},
        "concepts": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "label": {"type": "STRING"},
                    "nodeId": {"type": "STRING", "nullable": True},
                    "status": {"type": "STRING", "enum": list(MODEL_STATUSES)},
                    "evidenceTurnIds": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["label", "status"],
            },
        },
    },
    "required": ["narrative", "concepts"],
}

_EDGE_PUNCT = " .,;:!?-\u2013\u2014\"'()[]"


def concept_key(label: str) -> str:
    """The join key for a concept label: case-folded, whitespace-collapsed,
    edge punctuation stripped. A superset of the class concept rollup's
    normalisation (1.1.121, ``db.class_concept_rollup.normalise_concept``), so a
    map-backed concept here and in the class graph is one key, not two."""
    return " ".join(label.lower().split()).strip(_EDGE_PUNCT)


def concept_vocabulary(summary: SessionSummary) -> ConceptVocabulary:
    """The activity's concept map + the tutor's ``demonstrated`` evidence for
    this group. Synchronous Firestore — call through ``asyncio.to_thread``.
    Best-effort: any failure is an open vocabulary with nothing demonstrated."""
    activity_id = summary.lesson_activity_id or summary.activity_id
    vocab = ConceptVocabulary()
    try:
        from db.activities import get_activity

        activity = get_activity(activity_id) if activity_id else None
        if activity is not None and activity.concept_map:
            vocab.nodes = [{"id": n.id, "label": n.label} for n in activity.concept_map[0].nodes]
        if vocab.nodes and summary.group_code:
            from db.concept_progress import get_node_states

            states = get_node_states(summary.group_code, activity_id)
            vocab.demonstrated = {nid for nid, st in states.items() if st.get("status") == "demonstrated"}
    except Exception as exc:  # the vocabulary is an aid; the narrative must not depend on it
        log.warning("narrative: concept vocabulary failed for %s (%s)", summary.session_id, type(exc).__name__)
    return vocab


def _concepts_instruction(vocab: ConceptVocabulary) -> str:
    if vocab.closed:
        listed = "\n".join(f"- {n['id']}: {n['label']}" for n in vocab.nodes)
        vocabulary = (
            "The activity has a concept map. Map every concept to one of these node ids "
            "(nodeId), or set nodeId to null if it matches none of them:\n" + listed
        )
    else:
        vocabulary = "The activity has no concept map: give each concept a short label (1-4 words), nodeId null."
    return (
        "\n\nReturn JSON with two fields. `narrative`: the Markdown above, exactly as you would "
        "have written it. `concepts`: at most "
        f"{MAX_CONCEPTS} physics concepts the group engaged with, each with `label`, `nodeId`, "
        '`status` and `evidenceTurnIds` (the t-numbers of the turns that show it, e.g. "t12"). '
        "`status` is `struggled` if the group visibly had difficulty with it, otherwise `discussed`. "
        "Never judge whether the group mastered a concept — that is recorded elsewhere.\n"
        f"{vocabulary}\n"
    )


def build_report_prompt(summary: SessionSummary, vocab: ConceptVocabulary) -> str:
    """The narrative prompt plus the structured-concepts instruction (M0)."""
    return build_narrative_prompt(summary) + _concepts_instruction(vocab)


_TURN_ID = re.compile(r"^t?(\d+)$")


def finalise_concepts(raw: Any, vocab: ConceptVocabulary) -> list[dict[str, Any]]:
    """Validate the model's concepts against the vocabulary and add the tutor's
    ``demonstrated`` evidence. Pure.

    * A ``nodeId`` outside the map becomes null (closed vocabulary), and a
      mapped concept takes the NODE's label, so eight groups' phrasings of one
      node are one row.
    * ``demonstrated`` is never taken from the model; it is set only where the
      tutor's record says so — including for a node the model did not mention.
    * Duplicates (same key) merge, ``struggled`` winning over ``discussed``.
    """
    labels = {n["id"]: n["label"] for n in vocab.nodes}
    out: dict[str, dict[str, Any]] = {}
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        node_id = item.get("nodeId") or None
        if node_id not in labels:
            node_id = None
        label = labels[node_id] if node_id else str(item.get("label") or "").strip()[:80]
        key = concept_key(label)
        if not key:
            continue
        if key not in out and len(out) >= MAX_CONCEPTS:
            continue
        status = item.get("status") if item.get("status") in MODEL_STATUSES else "discussed"
        entry = out.setdefault(
            key, {"key": key, "label": label, "nodeId": node_id, "status": status, "evidenceTurnIds": []}
        )
        if status == "struggled":
            entry["status"] = "struggled"
        for t in item.get("evidenceTurnIds") or []:
            m = _TURN_ID.match(str(t).strip())
            tid = f"t{m.group(1)}" if m else None
            if tid and tid not in entry["evidenceTurnIds"] and len(entry["evidenceTurnIds"]) < 8:
                entry["evidenceTurnIds"].append(tid)
    for node_id in sorted(vocab.demonstrated):
        if node_id not in labels:
            continue
        key = concept_key(labels[node_id])
        entry = out.setdefault(
            key,
            {"key": key, "label": labels[node_id], "nodeId": node_id, "status": "demonstrated", "evidenceTurnIds": []},
        )
        entry["status"] = "demonstrated"
        entry["nodeId"] = node_id
    return list(out.values())


def parse_report(raw: str, vocab: ConceptVocabulary) -> NarrativeResult:
    """The model's reply → narrative + concepts. A reply that is not the JSON
    object (a plain-Markdown answer) is kept as the narrative with concepts
    ``None`` — the report must not lose its summary because extraction failed."""
    text = (raw or "").strip()
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return NarrativeResult(text=text, concepts=None)
    if not isinstance(data, dict) or not isinstance(data.get("narrative"), str):
        return NarrativeResult(text=text, concepts=None)
    return NarrativeResult(text=data["narrative"].strip(), concepts=finalise_concepts(data.get("concepts"), vocab))


async def _call_gemini(prompt: str, *, schema: dict[str, Any] | None = None) -> str:
    """Run the prompt through the analysis model. With ``schema`` the reply is
    JSON constrained by Gemini ``response_schema`` (1.1.139 M0). Mocked in tests."""
    from google import genai

    client = genai.Client(vertexai=True)
    kwargs: dict[str, Any] = {"model": analysis_model(), "contents": prompt}
    if schema is not None:
        from google.genai import types

        kwargs["config"] = types.GenerateContentConfig(response_mime_type="application/json", response_schema=schema)
    response = await client.aio.models.generate_content(**kwargs)
    return (response.text or "").strip()


async def generate_report(summary: SessionSummary, vocab: ConceptVocabulary | None = None) -> NarrativeResult:
    """ONE model call → the Markdown narrative AND the structured concepts
    (1.1.139 M0). Empty session → empty result, no call."""
    if not summary.conversation and not (summary.voice_transcript or "").strip():
        return NarrativeResult(text="", concepts=None)
    if vocab is None:
        vocab = await asyncio.to_thread(concept_vocabulary, summary)
    raw = await _call_gemini(build_report_prompt(summary, vocab), schema=NARRATIVE_SCHEMA)
    return parse_report(raw, vocab)


async def generate_narrative(summary: SessionSummary) -> str:
    """Generate (uncached) the narrative for a summary. Empty conversation
    yields an empty string — nothing to summarise."""
    return (await generate_report(summary)).text


def concept_cache_fields(concepts: list[dict[str, Any]] | None) -> dict[str, Any]:
    """The M0 fields on the summary cache doc (``chat_sessions/{id}``). Empty
    when nothing was extracted, so a failed extraction never overwrites a good
    earlier one with nothing."""
    if concepts is None:
        return {}
    return {
        "concepts": concepts,
        "conceptsModel": analysis_model(),
        "conceptsVersion": CONCEPTS_VERSION,
        "conceptsGeneratedAt": datetime.now(UTC).isoformat(),
    }


async def resolve_narrative(summary: SessionSummary, *, force: bool = False) -> str | None:
    """Return the narrative for ``summary`` — cached on the session index
    when fresh, regenerated when the live message count has grown.

    ``force=True`` bypasses the cache + debounce and regenerates now (the
    teacher's manual "Refresh summary" on a live report); the fresh text is
    still written back to the cache.

    Mutates ``summary.narrative`` in place and returns it. Generation
    failures are swallowed (logged) so the report still renders without a
    narrative — the metadata + transcript remain useful on their own.
    """
    if not summary.conversation and not (summary.voice_transcript or "").strip():
        return None

    # 1.1.131 follow-up: the Firestore reads/writes here are synchronous and this
    # runs inside the async report route — offloaded so a report cannot hold the
    # event loop a class's streams share.
    idx = await asyncio.to_thread(get_session_index, summary.session_id)
    live_count = summary.message_count
    live_voice = len((summary.voice_transcript or "").strip())
    if not force and idx is not None and idx.summary_text:
        cached_turns = idx.summary_based_on_turn_count or 0
        cached_voice = getattr(idx, "summary_based_on_voice_chars", None) or 0
        grew = live_count > cached_turns or live_voice > cached_voice
        # Serve the cache unless the content grew AND we're past the debounce — so a
        # teacher refreshing a live lesson re-runs the LLM at most once per 5 min.
        if not grew or _within_debounce(getattr(idx, "summary_generated_at", None)):
            summary.narrative = idx.summary_text
            return summary.narrative

    try:
        result = await generate_report(summary)
    except Exception as exc:  # narrative is best-effort; never break the report
        log.warning("narrative: generation failed for %s (%s)", summary.session_id, type(exc).__name__)
        return None

    text = result.text
    summary.narrative = text or None
    if idx is not None and text:
        try:
            await asyncio.to_thread(
                update_session_fields,
                summary.session_id,
                {
                    "summaryText": text,
                    "summaryGeneratedAt": datetime.now(UTC).isoformat(),
                    "summaryBasedOnTurnCount": live_count,
                    "summaryBasedOnVoiceChars": live_voice,
                    **concept_cache_fields(result.concepts),
                },
            )
        except Exception as exc:  # caching is best-effort
            log.warning("narrative: cache write failed for %s (%s)", summary.session_id, type(exc).__name__)
    return summary.narrative


__all__ = [
    "CONCEPTS_VERSION",
    "ConceptVocabulary",
    "NarrativeResult",
    "build_narrative_prompt",
    "build_report_prompt",
    "concept_cache_fields",
    "concept_key",
    "concept_vocabulary",
    "finalise_concepts",
    "generate_narrative",
    "generate_report",
    "parse_report",
    "resolve_narrative",
]
