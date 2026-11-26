"""Rolling live class summary (1.1.31 M1) — placeholder-framework variant.

A class-level Gemini-Flash roll-up over the deterministic group signals, framed
in the placeholder R1 framework (``analytics/live_framework.py``). Debounced +
cached to ~5 min per class so an active class costs at most one Flash call per
window and a teacher's 10s poll mostly serves the cache.

**Gated** behind ``AIPLA_LIVE_SUMMARY`` (default off): the framework is a
placeholder pending AR's R1 sign-off, so we don't show teachers AI-framed
engagement summaries built on an unconfirmed rubric until it's switched on
(mirrors the authoring co-pilot's dev-flag pattern). The deterministic live
layer (1.1.31 M0) is always on and never depends on this.

Cache is in-process (per Cloud Run instance) — acceptable for v1 on-demand use
(worst case: a cross-instance cache miss regenerates). No always-on job; SSE/
shared cache is a later enhancement.

Design doc: docs/design/aipla/v1.1.0-feedback/teacher-analytics-framework.md

**1.1.163 M4 (2026-11-26) — the summary reads the work.** It used to get a status,
a turn count and a stuck flag per group, and nothing a group did. So it could
only restate the table, and on dev it called an active group "stuck working on
an 'unknown activity'", in English on a Danish page. Now, when it regenerates,
it also gets per group:
- where the group is working and whether its page is open (1.1.161);
- the counted last 10 minutes from ``analytics/group_window.py`` (words per
  sheet, sim changes, questions, feedback requests).

It writes in the teacher's language, may call a group stuck only when the
signal says so, and never names an activity it was not given. The windows are
read only when the summary regenerates (at most once per 5 min per class and
language), never on the 10-second poll.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from analytics.live_framework import DEFAULT_FRAMEWORK, LiveFrameworkConfig

log = logging.getLogger(__name__)

SUMMARY_DEBOUNCE = timedelta(minutes=5)


@dataclass
class LiveSummary:
    text: str
    framework: str
    generated_at: str  # ISO-8601


# class_id -> (generated_at, signature, summary)
_cache: dict[str, tuple[datetime, str, LiveSummary]] = {}


def summary_enabled() -> bool:
    """Whether the placeholder-framework summary is switched on (env-gated)."""
    return os.environ.get("AIPLA_LIVE_SUMMARY", "").strip().lower() in ("1", "true", "yes", "on")


#: How many groups get a recent-activity window per regeneration (one BigQuery
#: read pair each). A class larger than this still gets a summary; the rest are
#: described from their signals only.
WINDOW_GROUPS_MAX = 12
WINDOW_MINUTES = 10

_LANGUAGE = {"da": "Danish", "en": "English"}
_WHERE = {
    "chat": "talking to the tutor",
    "table": "in the data table",
    "writing": "writing",
    "checklist": "on the checklist",
    "concept_map": "on the concept map",
    "sim": "in the simulation",
    "document": "reading a document",
}


def _signature(signals) -> str:
    return "|".join(
        f"{s.group_code}:{s.turns}:{s.status}:{int(s.stuck)}:"
        f"{getattr(s, 'last_work_kind', 'chat')}:{getattr(s, 'page_open', None)}"
        for s in signals
    )


def _window_line(win) -> str:
    """The counted last minutes, as one line (no student text)."""
    if win is None:
        return "not available"
    if win.empty:
        return "nothing"
    parts = [f"wrote {c.words_now - c.words_before:+d} words in '{c.title or 'a writing sheet'}'" for c in win.sheets]
    parts += [f"{c.changes} change(s) in the simulation '{c.name}'" for c in win.sims]
    if win.table_edits:
        parts.append(f"{win.table_edits} data-table edit(s)")
    if win.questions:
        parts.append(f"{win.questions} question(s) to the tutor")
    if win.feedback_requests:
        parts.append(f"{win.feedback_requests} request(s) for feedback on their writing")
    if win.tutor_turns:
        parts.append(f"{win.tutor_turns} tutor repl(ies)")
    if win.documents_opened:
        parts.append(f"opened {win.documents_opened} document(s)")
    return "; ".join(parts)


def _group_line(s, win) -> str:
    idle_min = max(1, round(getattr(s, "idle_seconds", 0) / 60))
    state = "active now" if s.status == "active" else f"no activity for {idle_min} min"
    bits = [state]
    where = _WHERE.get(getattr(s, "last_work_kind", "") or "")
    if where and s.status == "active":
        bits.append(where)
    page_open = getattr(s, "page_open", None)
    if page_open is True and s.status != "active":
        bits.append("page open")
    elif page_open is False:
        bits.append("page closed")
    if s.stuck:
        bits.append("STUCK (was working, then nothing for a while with the page open)")
    if s.activity_title:
        bits.append(f"activity '{s.activity_title}'")
    line = f"- {s.group_code}: " + ", ".join(bits)
    if win is not ...:
        line += f". Last {WINDOW_MINUTES} min: {_window_line(win)}"
    return line


def build_prompt(signals, framework: LiveFrameworkConfig, windows: dict | None = None, lang: str = "da") -> str:
    """The summary prompt. ``windows``: {code: GroupWindow | None}; a group absent
    from it gets no window line at all (beyond the cap, or no windows read)."""
    windows = windows or {}
    lines = [_group_line(s, windows.get(s.group_code, ...)) for s in signals]
    rules = (
        f"Write in {_LANGUAGE.get(lang, 'Danish')}. Call a group stuck ONLY if its line says STUCK. "
        "A group working in the simulation, table or writing without chatting is working, not passive or stuck. "
        "Describe what groups are doing from their last-minutes line, and never invent work it does not show. "
        "Never mention an activity that is not named, and never write 'unknown activity'. "
        "Do not quote students. If a group may need the teacher, say which one and why. "
        "Talk about the groups, never about this data: do not mention signals, flags, lines or windows."
    )
    return f"{framework.prompt_preamble}\n\n{rules}\n\nLive group signals:\n" + "\n".join(lines)


async def _read_windows(signals) -> dict:
    """{code: GroupWindow | None} for up to WINDOW_GROUPS_MAX groups, off the loop.
    A failed read is None for that group (said as 'not available'), never empty."""
    from analytics.group_window import read_group_window

    codes = [s.group_code for s in signals][:WINDOW_GROUPS_MAX]

    async def one(code):
        try:
            return await asyncio.to_thread(read_group_window, code, WINDOW_MINUTES)
        except Exception:
            log.warning("live summary: window read failed for a group", exc_info=True)
            return None

    return dict(zip(codes, await asyncio.gather(*(one(c) for c in codes)), strict=True))


async def _call_model(prompt: str) -> str:
    """Run the prompt on the ``live_summary`` model (plain text). Mocked in tests."""
    from llm import generate

    return (await generate(prompt, purpose="live_summary")).text.strip()


async def resolve_live_summary(
    class_id: str,
    signals,
    *,
    framework: LiveFrameworkConfig = DEFAULT_FRAMEWORK,
    now: datetime | None = None,
    lang: str = "da",
) -> LiveSummary | None:
    """Cached, debounced class summary. Returns None when disabled, when there
    are no active groups, or on generation failure (caller renders the
    deterministic layer regardless)."""
    if not summary_enabled() or not signals:
        return None

    now = now or datetime.now(UTC)
    lang = lang if lang in _LANGUAGE else "da"
    key = f"{class_id}:{lang}"
    sig = _signature(signals)
    cached = _cache.get(key)
    if cached:
        gen_at, cached_sig, summary = cached
        # Within the debounce window, or nothing changed → serve the cache.
        if now - gen_at < SUMMARY_DEBOUNCE or cached_sig == sig:
            return summary

    try:
        windows = await _read_windows(signals)
        text = await _call_model(build_prompt(signals, framework, windows, lang))
    except Exception as exc:
        log.warning("live summary: generation failed for %s (%s)", class_id, type(exc).__name__)
        return cached[2] if cached else None

    if not text:
        return cached[2] if cached else None

    summary = LiveSummary(text=text, framework=framework.name, generated_at=now.isoformat())
    _cache[key] = (now, sig, summary)
    return summary
