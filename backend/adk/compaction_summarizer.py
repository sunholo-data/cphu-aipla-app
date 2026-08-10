"""Compaction summarizer — what survives when history is condensed.

Compaction is LOSSY AND IRREVERSIBLE: the summary this produces REPLACES the
raw turns in every subsequent model request, and nothing downstream can reach
past it. Whatever this drops is gone for the rest of the conversation. So the
summarizer is a correctness surface, not a formatting detail.

Two problems with ADK's stock `LlmEventSummarizer` made an explicit one
necessary rather than nice-to-have (found upstream, COMPACTION-WIRE M2):

1. **It drops tool results entirely.** `_format_events_for_prompt` keeps only
   `part.text`, skipping `function_call` / `function_response`. On this
   platform the substance often IS the tool output — curriculum passages the
   tutor retrieved, calculator results, checklist and progress state, sim
   snapshots. Left as-is, a compacted tutoring conversation would summarise
   the chat *around* the work and silently discard the work.

2. **The default binds itself to a shared config object.** ADK's
   `_ensure_compaction_summarizer` does `config.summarizer = LlmEventSummarizer(
   llm=agent.canonical_model)` — an in-place mutation. Our configs are shared
   (module-level in `adk/session.py`, and `from_app` shallow-copies the App per
   request), so the FIRST skill to compact would pin its own model as the
   summarizer for every skill afterwards. Setting `summarizer` explicitly makes
   `_ensure_compaction_summarizer` return early, which closes that hole.

The prompt also matters. ADK's default asks for a summary that is "concise" and
captures "the essence" — reasonable for chit-chat, wrong for physics tutoring,
where the specifics ARE the content. A numeric result, a formula the student
derived, or a misconception the tutor corrected paraphrased away is
indistinguishable from one that was never said.
"""

from __future__ import annotations

import logging

from google.adk.apps.llm_event_summarizer import LlmEventSummarizer
from google.adk.events.event import Event

logger = logging.getLogger(__name__)

# Preserve specifics over brevity. Concision is what a summariser optimises for
# by default, and it is precisely wrong here: the student established these
# facts over many turns and the tutor must be able to refer back to them.
#
# The findings-vs-environment distinction and the opaque-id ban come from
# upstream's measured failure (findings log §3.1): every summary reproduced a
# 20-document directory listing complete with raw `[ref: <uuid>]` handles, in
# perpetuity, crowding out the actual work.
FIDELITY_PROMPT_TEMPLATE = (
    "You are compacting the earlier part of a tutoring conversation so it can "
    "continue within a context limit. Your summary REPLACES those turns — the "
    "assistant will never see the originals again, so anything you omit is "
    "permanently lost.\n\n"
    "Preserve, verbatim and in full:\n"
    "- Every number, unit, formula, calculated result, date and deadline\n"
    "- Every problem, exercise, activity or curriculum reference (problem "
    "numbers, activity names, section refs), and what was said about it\n"
    "- Every step of reasoning the student worked through, every misconception "
    "surfaced, and every correction issued — by the student or the tutor\n"
    "- Every conclusion reached and decision made\n"
    "- Every open question, unresolved difficulty and outstanding task\n"
    "- Any explicit instruction about how to work "
    "(language, tone, format, level of hints, what to avoid)\n\n"
    "FINDINGS vs ENVIRONMENT — this distinction matters more than any other:\n"
    "- A FINDING is what a tool discovered or computed: retrieved curriculum "
    "passages, calculator results, sim readings, progress assessments. Carry "
    "findings across in full — they are the work, and they cannot be recovered "
    "once these turns are gone.\n"
    "- ENVIRONMENT STATE is what merely exists: which documents are available, "
    "which tools were listed, directory or inventory output, connection status. "
    "Do NOT reproduce it. The assistant can re-query it at any time, and copying "
    "it forward crowds out the actual work. At most say what was being worked on "
    "('the projectile-motion problem set'), never reproduce the listing.\n\n"
    "NEVER carry across opaque system identifiers — UUIDs, `[ref: …]` handles, "
    "`gs://` paths, internal document or session ids. They are machine addressing, "
    "they are meaningless to a reader, and repeating them invites the assistant to "
    "quote or transform them incorrectly. Refer to things by their human name "
    "(the filename, the activity, the problem number).\n\n"
    "Do NOT compress by generalising. 'Worked on energy conservation' is a "
    "failure; 'derived v = sqrt(2gh), got 14 m/s for h = 10 m, then corrected a "
    "sign error in the potential-energy term' is correct. Prefer a long summary "
    "that keeps the facts over a short one that reads well — but length must "
    "come from FINDINGS, never from restating the environment.\n"
    "Attribute statements to the student or the tutor where it matters.\n\n"
    "Conversation to compact:\n\n{conversation_history}"
)

# Tool payloads can be enormous (a full curriculum retrieval, a sim snapshot).
# Sending them whole into the summariser risks blowing the very context limit
# compaction exists to relieve, so each is capped. Generous, because truncating
# a finding is the failure mode we are trying to avoid — this is a backstop
# against pathological payloads, not a compression strategy.
_MAX_TOOL_PAYLOAD_CHARS = 4000


def _truncate(text: str, limit: int = _MAX_TOOL_PAYLOAD_CHARS) -> str:
    """Cap a payload, and SAY SO when capped.

    A silent truncation would let the summariser treat a partial result as the
    whole finding and state it with unearned confidence.
    """
    if len(text) <= limit:
        return text
    return f"{text[:limit]}… [truncated, {len(text) - limit} more chars]"


# CUSTOM AG-UI event name for "history was summarised". Rides the same pending
# queue as STAGE_PROGRESS, drained by `stream_agui_events`.
COMPACTION_EVENT_NAME = "HISTORY_COMPACTED"

# Fired BEFORE summarisation begins. `HISTORY_COMPACTED` reports a completed
# compaction and therefore lands tens of seconds later, alongside RUN_FINISHED;
# this one tells the client the ANSWER is finished and only housekeeping
# remains, so the composer can re-enable instead of spinning through it.
COMPACTION_STARTED_EVENT_NAME = "COMPACTION_STARTED"


class FidelityEventSummarizer(LlmEventSummarizer):
    """`LlmEventSummarizer` that can see tool calls and tool results, and says
    when it has run.

    Only `_format_events_for_prompt` and `maybe_summarize_events` are
    overridden — the trigger logic, event construction and timestamps stay
    ADK's. We are widening what the summariser is shown and announcing the
    result, not reimplementing compaction.
    """

    def _format_events_for_prompt(self, events: list[Event]) -> str:
        lines: list[str] = []
        for event in events:
            if not (event.content and event.content.parts):
                continue
            author = event.author or "unknown"
            for part in event.content.parts:
                # Thoughts are the model's scratchpad, not conversation, and
                # they are already excluded from the request contents. Keeping
                # them would spend summary budget on reasoning the user never
                # saw and that no later turn can refer back to.
                if getattr(part, "thought", None):
                    continue
                if part.text:
                    lines.append(f"{author}: {part.text}")
                    continue
                fc = getattr(part, "function_call", None)
                if fc is not None:
                    args = _truncate(str(getattr(fc, "args", "") or ""))
                    lines.append(f"{author} called tool {getattr(fc, 'name', '?')}({args})")
                    continue
                fr = getattr(part, "function_response", None)
                if fr is not None:
                    payload = _truncate(str(getattr(fr, "response", "") or ""))
                    lines.append(f"tool {getattr(fr, 'name', '?')} returned: {payload}")
        return "\n".join(lines)

    async def maybe_summarize_events(self, *, events):
        """Summarise, then announce it — never silently.

        Compaction silently rewrites what the tutor can remember: the student
        keeps seeing a full transcript while the model sees a summary, so a
        degraded answer looks identical to a good one. That invisibility is
        what made the upstream incident undiagnosable.

        METADATA ONLY on the wire. Summaries derive from student conversation
        content — putting summary text in a CUSTOM event would route around
        every trust boundary the stream maintains. Counts and timestamps only.

        Fail-open throughout: compaction runs inside the request flow, so
        raising here would fail the user's turn, trading a silent degradation
        for a hard error. Losing the notice is the lesser harm.
        """
        # COMPACTION-LATENCY M2 — announce BEFORE the model call, not after.
        # `HISTORY_COMPACTED` below fires once summarisation RETURNS, which
        # upstream measured at ~35s later — roughly when RUN_FINISHED arrives,
        # far too late to tell the UI anything useful. Meanwhile the frontend
        # holds `isLoading` until the run finalises, so the composer sits
        # disabled with the answer already fully rendered on screen. Emitting
        # here says precisely "the answer is done; we are tidying up".
        if events:
            try:
                from observability.timing import get_current_tracker

                get_current_tracker().emit_reliability_event(
                    COMPACTION_STARTED_EVENT_NAME,
                    {"events_to_compact": len(events)},
                )
            except Exception as exc:
                logger.warning("compaction start notice not emitted (suppressed): %s", exc)

        compaction_event = await super().maybe_summarize_events(events=events)
        if compaction_event is None:
            # Nothing was compacted. Announcing a no-op would train people to
            # ignore the marker.
            return None

        try:
            from observability.timing import get_current_tracker

            summary_chars = 0
            comp = getattr(getattr(compaction_event, "actions", None), "compaction", None)
            content = getattr(comp, "compacted_content", None) if comp else None
            for part in getattr(content, "parts", None) or []:
                summary_chars += len(getattr(part, "text", "") or "")

            get_current_tracker().emit_reliability_event(
                COMPACTION_EVENT_NAME,
                {
                    "events_compacted": len(events),
                    # Length, not content: enough to spot a suspiciously tiny
                    # summary without putting the summary on the wire.
                    "summary_chars": summary_chars,
                    "start_timestamp": getattr(comp, "start_timestamp", None) if comp else None,
                    "end_timestamp": getattr(comp, "end_timestamp", None) if comp else None,
                },
            )
        except Exception as exc:
            logger.warning("compaction notice not emitted (suppressed): %s", exc)

        return compaction_event


def build_compaction_summarizer() -> LlmEventSummarizer | None:
    """The summarizer every compaction config carries.

    Pinned to one model rather than inheriting the compacting skill's, so a
    conversation's history is condensed the same way whichever skill happens to
    be answering when the threshold trips. The smart tier, not the platform
    default: summarising a long technical conversation without losing
    specifics is a harder task than most of the turns being summarised, and it
    runs rarely enough that the cost is negligible.

    Returns None if the model can't be resolved (an unmounted provider, a
    missing registry entry). ADK then falls back to its own default
    summarizer, which is worse but not broken — losing tool fidelity beats
    failing every turn once the threshold is crossed.
    """
    try:
        from adk.agent import resolve_model
        from config.models import smart_model

        llm = resolve_model(smart_model())
    except Exception as exc:
        logger.warning(
            "compaction summarizer unavailable (%s); ADK will use its default, which drops tool results from summaries",
            exc,
        )
        return None
    # `prompt_template` MUST be passed. Without it the base class silently falls
    # back to ADK's `_DEFAULT_PROMPT_TEMPLATE` ("concise… the essence"), so the
    # subclass would fix tool visibility while quietly keeping the prompt that
    # paraphrases away the specifics. Upstream shipped exactly that bug behind a
    # green test suite — see test_built_summarizer_actually_uses_our_prompt.
    return FidelityEventSummarizer(llm=llm, prompt_template=FIDELITY_PROMPT_TEMPLATE)
