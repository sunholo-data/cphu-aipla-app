"""Tools for the ``sim-author`` skill: check a sim draft, keep every version, show the model its page.

in-app-sim-authoring M4. A teacher describes a simulation; the skill drafts the
two files, calls ``verify_sim``, reads the verdict AND the screenshots of its
own page, repairs, and shows the teacher. Each call stores a version
(``db/sim_drafts``), so the teacher can iterate ("make the piston bigger") and
go back. Nothing is published: drafts are visible to their owner only.

The screenshots reach the model the way svg-illustrator's preview does: parked
in temp state by the tool, then attached INSIDE the matching function response
by ``attach_sim_screenshots`` in the agent's before-model hook (Gemini accepts
images there, not as a sibling part). The tool result itself carries no image
data, so it is small enough to stream to the teacher's chat card.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import re
import tempfile
from pathlib import Path
from typing import Any

from analytics.auth import caller_uid_or_none
from sim_authoring.verify import browser_from_env, verify_draft

logger = logging.getLogger(__name__)

TOOL_NAME = "verify_sim"
SHOTS_KEY = "temp:sim_verify_pngs"
ATTEMPTS_KEY = "temp:sim_verify_attempts"
#: Checks per teacher turn. Each one is a browser run plus a model call with
#: images; past this the model is told to answer with what it has.
MAX_CHECKS_PER_TURN = 5
MODEL_SHOTS = ("700", "driven")
REFERENCES = Path(__file__).resolve().parents[1] / "sim_authoring" / "references"
_REFERENCE_FILES = {
    "authoring-rules": "authoring-prompt.txt",
    "anatomy-kit": "anatomy-lite.md",
}


def _scoped(key: str, ctx: Any) -> str:
    inv = getattr(getattr(ctx, "_invocation_context", None), "invocation_id", None)
    return f"{key}:{inv}" if isinstance(inv, str) and inv else key


def _draft_id(ctx: Any) -> str | None:
    session = getattr(getattr(ctx, "_invocation_context", None), "session", None)
    sid = getattr(session, "id", None)
    if not isinstance(sid, str) or not sid:
        return None
    return re.sub(r"[^A-Za-z0-9_-]", "_", sid)[:128]


async def verify_sim(
    index_html: str, catalogue_yaml: str, hidden_terms: list[str] | None = None, tool_context: Any = None
) -> dict:
    """Check a simulation draft and keep it as a new version the teacher can see.

    Call this with BOTH complete files every time you change anything, before you
    show the teacher. It runs the platform's real gates, then opens the page in a
    real browser: the self-test, fit at 390 and 700 px, whether pressing start
    moves the drawing, and the events it emits when clicked through. Screenshots
    of the page are attached to this result: LOOK at them, and check that what is
    drawn agrees with the physics at that moment (positions, which parts move,
    directions). Fix what is wrong and call again.

    Args:
        index_html: The complete index.html.
        catalogue_yaml: The complete catalogue entry (YAML).
        hidden_terms: What the student must work out and must NOT see, as it
            could appear on screen: the symbol, the word in Danish and English,
            the value (e.g. ["g", "tyngdeacceleration", "9.82", "9,82"]). Pass
            them every time; the check fails if any appears in a label, a
            readout string or an event label.

    Returns:
        ``level`` (0-3; 3 means valid, running and wired to the tutor, NOT that
        the physics is right), what failed and how to fix it, what was not
        checked, the events the page emitted, and the ``version`` stored.
    """
    if tool_context is not None:
        key = _scoped(ATTEMPTS_KEY, tool_context)
        used = int(tool_context.state.get(key) or 0) + 1
        tool_context.state[key] = used
        if used > MAX_CHECKS_PER_TURN:
            return {
                "ok": False,
                "refused": f"That was check {used}; the limit is {MAX_CHECKS_PER_TURN} per turn. Do not call "
                "verify_sim again this turn: tell the teacher where the draft stands and what you would change next.",
            }
    owner = caller_uid_or_none(tool_context)
    draft_id = _draft_id(tool_context)
    if owner is None or draft_id is None:
        return {"ok": False, "refused": "No signed-in teacher or conversation for this draft; it was not stored."}

    with tempfile.TemporaryDirectory(prefix="simauthor-") as tmp:
        verdict = await verify_draft(
            index_html,
            catalogue_yaml,
            hidden_terms=[t for t in (hidden_terms or []) if isinstance(t, str) and t.strip()][:20] or None,
            browser=browser_from_env(),
            out_dir=Path(tmp),
        )
        shots = {k: base64.b64encode(p.read_bytes()).decode("ascii") for k, p in verdict.screenshots.items()}
    artefact_id = None
    m = re.search(r"\bARTEFACT_NAME\s*=\s*[\"']([^\"']+)[\"']", index_html or "")
    if m:
        artefact_id = m.group(1)[:64]

    from db.sim_drafts import add_version

    try:
        version = await asyncio.to_thread(
            add_version,
            draft_id=draft_id,
            owner_uid=owner,
            index_html=index_html or "",
            catalogue_yaml=catalogue_yaml,
            level=verdict.level,
            reasons=verdict.reasons,
            screenshots={k: v for k, v in shots.items() if k in (*MODEL_SHOTS, "390")},
            artefact_id=artefact_id,
        )
    except Exception as exc:  # storage failing must not hide the verdict from the model
        logger.warning("sim draft not stored: %s", type(exc).__name__)
        version = None

    model_shots = [shots[k] for k in MODEL_SHOTS if k in shots]
    if tool_context is not None and model_shots:
        tool_context.state[_scoped(SHOTS_KEY, tool_context)] = model_shots
    result = verdict.for_model()
    result.update(draft_id=draft_id, version=version)
    if not model_shots:
        result["note"] = "No screenshots: the browser check did not run, so nothing above level 1 is known."
    return result


async def read_reference(topic: str) -> str:
    """Read a reference you need while building a simulation.

    Args:
        topic: ``authoring-rules`` — the full rules every sim must follow (the file
            format, the bridge lines, telemetry, the self-test, what must not be in
            the frame). ``anatomy-kit`` — how to draw the apparatus as a crafted
            isometric figure with the vendored anatomy kit, with a worked example.

    Returns:
        The reference text.
    """
    name = _REFERENCE_FILES.get((topic or "").strip().lower())
    if name is None:
        return f"Unknown topic {topic!r}. Topics: {', '.join(sorted(_REFERENCE_FILES))}."
    return (REFERENCES / name).read_text(encoding="utf-8")


async def attach_sim_screenshots(callback_context: Any, llm_request: Any) -> bool:
    """Put parked verify_sim screenshots inside their function response; True if attached."""
    state = getattr(callback_context, "state", None)
    if state is None:
        return False
    key = _scoped(SHOTS_KEY, callback_context)
    shots = state.get(key)
    if not shots:
        return False
    state[key] = []

    from google.genai import types

    contents = getattr(llm_request, "contents", None) or []
    if not contents:
        return False
    for part in reversed(contents[-1].parts or []):
        fr = getattr(part, "function_response", None)
        if fr is not None and fr.name == TOOL_NAME:
            fr.parts = [
                types.FunctionResponsePart.from_bytes(data=base64.b64decode(s), mime_type="image/png") for s in shots
            ]
            return True
    logger.warning("sim screenshots parked but no verify_sim response in the request; dropped")
    return False
