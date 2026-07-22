"""``summarise_chat_excerpts`` — bounded BQ sample + single LLM
paraphrase pass for misconception/topic-cluster questions.

This is the only analytics tool that touches free-form chat content.
The constraints are deliberate:

1. **Bounded sample.** At most ``MAX_SAMPLE_TURNS = 200`` student turns
   are fetched. The agent cannot ask for more.
2. **Group-code redaction.** Real group codes (``bold-kazoo-87``) are
   replaced with placeholders (``G1``, ``G2``, ...) BEFORE the LLM
   sees them. The mapping is discarded after the call — the LLM
   cannot leak a real group code because it never saw one.
3. **Paraphrase-strict prompt.** The LLM is instructed to extract
   themes + paraphrase examples; verbatim quoting is explicitly
   forbidden.
4. **Verbatim-substring defense.** After the LLM returns, we check
   every theme's ``example_paraphrase`` against the original sample.
   Any theme containing a ≥40-character substring matching a sampled
   turn is dropped. Defense in depth against a model that ignores the
   prompt.

This stays well clear of the post-pilot 2.5 ``session-analytics-rubric``
work. It answers "what topics came up?", not "did engagement reach
ICAP-constructive?".

Out of scope for this design: clustering at scale, embedding indexes,
taxonomy hierarchies. Those are 2.5.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from analytics.auth import (
    PERMISSION_ERROR_MESSAGE,
    assert_caller_owns,
    resolve_caller_group_codes,
)
from config.models import fast_model
from db.bigquery import CHAT_TURN_TABLE, run_query, table_ref
from db.classes import get_class

logger = logging.getLogger(__name__)


#: Hard cap. The agent cannot exceed this regardless of `sample_size`
#: requested. The LLM context budget + the chat-log query cost are the
#: two reasons; the second is the binding one.
MAX_SAMPLE_TURNS = 200

#: Substring length above which a returned theme is rejected as
#: insufficiently paraphrased. 40 chars catches whole phrases without
#: false-positiving on short physics-vocabulary fragments
#: ("acceleration", "Planck constant") that legitimately recur.
VERBATIM_THRESHOLD = 40

#: Default sample size when the caller omits one. Below the hard cap.
DEFAULT_SAMPLE_SIZE = 50

#: Model — same tier as the analytics-chat skill itself, kept in this
#: file rather than imported from the SKILL.md to avoid a circular
#: load. Update both if the skill model changes.
_SUMMARISE_MODEL = fast_model()


def _sample_turns_sql(*, has_topic: bool) -> str:
    """Build the sampling SQL. Random sampling via ``RAND() < @ratio``
    is cheap and approximate — exact since-time-window matters more
    than exact-N matches the user."""
    topic_clause = "AND LOWER(jsonPayload.content) LIKE CONCAT('%', LOWER(@topic_keyword), '%')" if has_topic else ""
    return f"""
        SELECT
          jsonPayload.group_id AS group_code,
          jsonPayload.skill_id AS skill_id,
          jsonPayload.content AS content
        FROM {table_ref(CHAT_TURN_TABLE)}
        WHERE jsonPayload.role = 'student'
          AND jsonPayload.group_id IN UNNEST(@class_group_codes)
          AND jsonPayload.group_id IN UNNEST(@allowed_group_codes)
          AND timestamp BETWEEN @since AND @until
          {topic_clause}
        ORDER BY RAND()
        LIMIT @sample_size
    """.strip()


def _fetch_sample(
    *,
    since: datetime,
    until: datetime,
    allowed_group_codes: list[str],
    class_group_codes: list[str],
    topic_keyword: str | None,
    sample_size: int,
) -> list[dict[str, Any]]:
    if not class_group_codes or not allowed_group_codes:
        return []

    bounded = max(1, min(int(sample_size), MAX_SAMPLE_TURNS))
    params: dict[str, Any] = {
        "since": since,
        "until": until,
        "class_group_codes": list(class_group_codes),
        "allowed_group_codes": list(allowed_group_codes),
        "sample_size": bounded,
    }
    if topic_keyword:
        params["topic_keyword"] = topic_keyword

    sql = _sample_turns_sql(has_topic=bool(topic_keyword))
    rows = run_query(sql, params=params)
    return [
        {
            "group_code": r["group_code"],
            "skill_id": r["skill_id"],
            "content": r["content"],
        }
        for r in rows
    ]


def _redact_group_codes(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Replace real group codes with placeholders. Returns the redacted
    rows + a forward mapping (real → placeholder) for debugging in
    structured logs only. The reverse mapping is never returned to the
    caller.
    """
    mapping: dict[str, str] = {}
    redacted: list[dict[str, Any]] = []
    for row in rows:
        real_code = row["group_code"]
        placeholder = mapping.get(real_code)
        if placeholder is None:
            placeholder = f"G{len(mapping) + 1}"
            mapping[real_code] = placeholder
        redacted.append(
            {
                "group_code": placeholder,
                "skill_id": row["skill_id"],
                "content": row["content"],
            }
        )
    return redacted, mapping


def _build_prompt(redacted_rows: list[dict[str, Any]], topic_keyword: str | None) -> str:
    topic_hint = f" related to '{topic_keyword}'" if topic_keyword else ""
    rows_json = json.dumps(redacted_rows, ensure_ascii=False)
    return (
        "You are reviewing anonymised student chat turns from a physics tutoring "
        f"session{topic_hint}. Extract up to 5 recurring themes (topics, "
        "misconceptions, or questions) that appear across multiple groups.\n\n"
        "Constraints:\n"
        "- Paraphrase every example. NEVER quote verbatim student text.\n"
        "- Group codes are anonymised as G1, G2, ... — do not invent real codes.\n"
        "- Return ONLY valid JSON matching this schema; no commentary, no markdown:\n"
        '  {"themes": [{"theme": str, "frequency": int, "example_paraphrase": str}, ...]}\n\n'
        f"Student turns (JSON):\n{rows_json}"
    )


async def _call_gemini(prompt: str) -> str:
    """Run the prompt through Gemini Flash. Mocked in unit tests."""
    from google import genai

    client = genai.Client(vertexai=True)
    response = await client.aio.models.generate_content(
        model=_SUMMARISE_MODEL,
        contents=prompt,
        config={"response_mime_type": "application/json"},
    )
    return response.text or ""


def _has_verbatim_overlap(text: str, sources: list[str]) -> bool:
    """True if any ``source`` contains a contiguous substring of
    length >= :data:`VERBATIM_THRESHOLD` that is also in ``text``.

    Naive O(n*m) scan over the threshold-window. Acceptable because
    ``len(sources) <= MAX_SAMPLE_TURNS`` and ``len(text)`` is bounded
    by the LLM output (low thousands of characters).
    """
    if len(text) < VERBATIM_THRESHOLD:
        return False
    for source in sources:
        for i in range(len(text) - VERBATIM_THRESHOLD + 1):
            window = text[i : i + VERBATIM_THRESHOLD]
            if window in source:
                return True
    return False


def _filter_verbatim_leaks(themes: list[dict[str, Any]], sample_contents: list[str]) -> list[dict[str, Any]]:
    """Drop themes whose ``example_paraphrase`` contains a long
    substring that appears verbatim in the sampled turns."""
    safe: list[dict[str, Any]] = []
    for theme in themes:
        example = str(theme.get("example_paraphrase", ""))
        if _has_verbatim_overlap(example, sample_contents):
            logger.warning("summarise_chat_excerpts: dropped theme with verbatim student text leak")
            continue
        safe.append(theme)
    return safe


def _parse_themes(text: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("summarise_chat_excerpts: LLM returned non-JSON; returning []")
        return []
    themes = parsed.get("themes", [])
    if not isinstance(themes, list):
        return []
    cleaned: list[dict[str, Any]] = []
    for t in themes:
        if not isinstance(t, dict):
            continue
        cleaned.append(
            {
                "theme": str(t.get("theme", "")),
                "frequency": int(t.get("frequency", 0)) if str(t.get("frequency", "")).isdigit() else 0,
                "example_paraphrase": str(t.get("example_paraphrase", "")),
            }
        )
    return cleaned


# ---------------------------------------------------------------------------
# Public entry point (registered as a FunctionTool by adk/tools.py)
# ---------------------------------------------------------------------------


async def summarise_chat_excerpts(
    class_id: str,
    topic_keyword: str | None = None,
    since: str | None = None,
    until: str | None = None,
    sample_size: int = DEFAULT_SAMPLE_SIZE,
    tool_context: Any = None,
) -> dict[str, Any]:
    """Extract paraphrased themes from a bounded sample of student
    chat turns for a class.

    Args:
        class_id: The class to query. Must be owned by the calling teacher.
        topic_keyword: Optional substring to narrow turns to (e.g.
            ``"projectile"``). Case-insensitive ``LIKE`` match on
            student message content.
        since: ISO timestamp (UTC). Defaults to 7 days ago.
        until: ISO timestamp (UTC). Defaults to now.
        sample_size: Soft cap (clamped to :data:`MAX_SAMPLE_TURNS`).

    Returns:
        ``{"themes": [{"theme", "frequency", "example_paraphrase"}, ...],
        "sampled": int}``. ``sampled`` is the actual row count the LLM
        saw — surfaces transparency when the BQ window has fewer rows
        than the requested ``sample_size``.
    """
    from analytics.tools import _caller_uid, _class_group_codes, _parse_since, _parse_until

    uid = _caller_uid(tool_context)
    assert_caller_owns(uid, class_id)
    cls = get_class(class_id)
    if cls is None:
        raise PermissionError(PERMISSION_ERROR_MESSAGE)
    allowed = list(resolve_caller_group_codes(uid))
    class_codes = _class_group_codes(class_id)
    since_dt = _parse_since(since)
    until_dt = _parse_until(until)

    sample = _fetch_sample(
        since=since_dt,
        until=until_dt,
        allowed_group_codes=allowed,
        class_group_codes=class_codes,
        topic_keyword=topic_keyword,
        sample_size=sample_size,
    )

    if not sample:
        return {"themes": [], "sampled": 0}

    redacted, _mapping = _redact_group_codes(sample)
    prompt = _build_prompt(redacted, topic_keyword)
    raw_response = await _call_gemini(prompt)
    themes = _parse_themes(raw_response)
    safe_themes = _filter_verbatim_leaks(themes, [r["content"] for r in sample])
    return {"themes": safe_themes, "sampled": len(sample)}


__all__ = [
    "DEFAULT_SAMPLE_SIZE",
    "MAX_SAMPLE_TURNS",
    "VERBATIM_THRESHOLD",
    "summarise_chat_excerpts",
]
