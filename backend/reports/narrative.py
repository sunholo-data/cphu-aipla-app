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

import logging
from datetime import UTC, datetime

from config.models import default_model
from db.chat_sessions import get_session_index, update_session_fields
from reports.session_summary import SessionSummary

log = logging.getLogger(__name__)

#: Model is config-driven — config/models.yaml platform_default (RAQ-1 follow-up).

_SYSTEM_PROMPT = """\
You are summarising a tutoring session for a teacher reviewing what happened.
Produce these sections, in order, as Markdown — no preamble, no emoji:

**Narrative** (3-5 sentences, past tense): What did the group explore? What was
their approach? Where did they get stuck?

**Concepts discussed** (3-6 bullets): key physics concepts that came up in the
conversation.

**Sim parameters explored** (bullets): which workbench parameters the group
actually varied. Use ONLY the parameters listed in the data below — do not
invent values. Omit this section if there were no workbench events.

**Checklist progress** (one line): include only if the data shows checklist
progress; otherwise omit.

**Next time** (one sentence): what this group most needs next session.

Draw on BOTH the chat and the spoken discussion below — the spoken transcript often
shows reasoning the chat doesn't; it may be imperfect, so don't over-quote it.

Refer to "the group" or "the students" — never to individuals. Do not quote
students verbatim. Maximum ~250 words.
"""


def build_narrative_prompt(summary: SessionSummary) -> str:
    """Assemble the grounded prompt from the conversation + workbench events."""
    convo_lines = [f"[{t.role}] {t.content}" for t in summary.conversation]
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


async def _call_gemini(prompt: str) -> str:
    """Run the prompt through Gemini Flash (plain text). Mocked in tests."""
    from google import genai

    client = genai.Client(vertexai=True)
    response = await client.aio.models.generate_content(
        model=default_model(),
        contents=prompt,
    )
    return (response.text or "").strip()


async def generate_narrative(summary: SessionSummary) -> str:
    """Generate (uncached) the narrative for a summary. Empty conversation
    yields an empty string — nothing to summarise."""
    if not summary.conversation and not (summary.voice_transcript or "").strip():
        return ""
    return await _call_gemini(build_narrative_prompt(summary))


async def resolve_narrative(summary: SessionSummary) -> str | None:
    """Return the narrative for ``summary`` — cached on the session index
    when fresh, regenerated when the live message count has grown.

    Mutates ``summary.narrative`` in place and returns it. Generation
    failures are swallowed (logged) so the report still renders without a
    narrative — the metadata + transcript remain useful on their own.
    """
    if not summary.conversation and not (summary.voice_transcript or "").strip():
        return None

    idx = get_session_index(summary.session_id)
    live_count = summary.message_count
    if (
        idx is not None
        and idx.summary_text
        and idx.summary_based_on_turn_count is not None
        and idx.summary_based_on_turn_count >= live_count
    ):
        summary.narrative = idx.summary_text
        return summary.narrative

    try:
        text = await generate_narrative(summary)
    except Exception as exc:  # narrative is best-effort; never break the report
        log.warning("narrative: generation failed for %s (%s)", summary.session_id, type(exc).__name__)
        return None

    summary.narrative = text or None
    if idx is not None and text:
        try:
            update_session_fields(
                summary.session_id,
                {
                    "summaryText": text,
                    "summaryGeneratedAt": datetime.now(UTC).isoformat(),
                    "summaryBasedOnTurnCount": live_count,
                },
            )
        except Exception as exc:  # caching is best-effort
            log.warning("narrative: cache write failed for %s (%s)", summary.session_id, type(exc).__name__)
    return summary.narrative


__all__ = ["build_narrative_prompt", "generate_narrative", "resolve_narrative"]
