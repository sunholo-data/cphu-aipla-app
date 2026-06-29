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
"""

from __future__ import annotations

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


def _signature(signals) -> str:
    return "|".join(f"{s.group_code}:{s.turns}:{s.status}:{int(s.stuck)}" for s in signals)


def build_prompt(signals, framework: LiveFrameworkConfig) -> str:
    lines = [
        f"- {s.group_code}: {s.status}, {s.turns} turns, "
        f"{'STUCK' if s.stuck else 'working'}, on '{s.activity_title or 'unknown activity'}'"
        for s in signals
    ]
    return f"{framework.prompt_preamble}\n\nLive group signals:\n" + "\n".join(lines)


async def _call_gemini(prompt: str) -> str:
    """Run the prompt through Gemini Flash (plain text). Mocked in tests."""
    from google import genai

    from config.models import default_model

    client = genai.Client(vertexai=True)
    response = await client.aio.models.generate_content(model=default_model(), contents=prompt)
    return (response.text or "").strip()


async def resolve_live_summary(
    class_id: str,
    signals,
    *,
    framework: LiveFrameworkConfig = DEFAULT_FRAMEWORK,
    now: datetime | None = None,
) -> LiveSummary | None:
    """Cached, debounced class summary. Returns None when disabled, when there
    are no active groups, or on generation failure (caller renders the
    deterministic layer regardless)."""
    if not summary_enabled() or not signals:
        return None

    now = now or datetime.now(UTC)
    sig = _signature(signals)
    cached = _cache.get(class_id)
    if cached:
        gen_at, cached_sig, summary = cached
        # Within the debounce window, or nothing changed → serve the cache.
        if now - gen_at < SUMMARY_DEBOUNCE or cached_sig == sig:
            return summary

    try:
        text = await _call_gemini(build_prompt(signals, framework))
    except Exception as exc:
        log.warning("live summary: generation failed for %s (%s)", class_id, type(exc).__name__)
        return cached[2] if cached else None

    if not text:
        return cached[2] if cached else None

    summary = LiveSummary(text=text, framework=framework.name, generated_at=now.isoformat())
    _cache[class_id] = (now, sig, summary)
    return summary
