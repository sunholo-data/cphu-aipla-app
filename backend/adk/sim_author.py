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
#: The tools whose function response carries the parked screenshots.
SCREENSHOT_TOOLS = frozenset({"verify_sim", "edit_sim"})
SHOTS_KEY = "temp:sim_verify_pngs"
ATTEMPTS_KEY = "temp:sim_verify_attempts"
PROGRESS_KEY = "temp:sim_progress_seq"
#: Checks per teacher turn. Each one is a browser run plus a model call with
#: images; past this the model is told to answer with what it has.
MAX_CHECKS_PER_TURN = 3
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


def _progress(tool_context: Any, key: str, label: str, **params: str | int) -> None:
    """Show the teacher what the skill is doing, as a stage label in the chat.

    Stage names must be unique per request (the tracker keeps the first mark of
    a name), so each label carries a counter. Fail-open: progress is cosmetic.
    """
    try:
        from observability.timing import get_current_tracker

        n = 0
        if tool_context is not None:
            ck = _scoped(PROGRESS_KEY, tool_context)
            n = int(tool_context.state.get(ck) or 0) + 1
            tool_context.state[ck] = n
        get_current_tracker().mark(f"sim_{key}_{n}", user_label=label, label_key=key, label_params=params or None)
    except Exception:  # never let a label break a tool
        logger.debug("sim progress label failed", exc_info=True)


def _spend_check(tool_context: Any) -> dict | None:
    """Count one browser check against the per-turn cap; the refusal past it, else None."""
    if tool_context is None:
        return None
    key = _scoped(ATTEMPTS_KEY, tool_context)
    used = int(tool_context.state.get(key) or 0) + 1
    tool_context.state[key] = used
    if used > MAX_CHECKS_PER_TURN:
        return {
            "ok": False,
            "refused": f"That was check {used}; the limit is {MAX_CHECKS_PER_TURN} per turn. Do not check again "
            "this turn: tell the teacher where the draft stands and what you would change next.",
        }
    return None


def _clean_terms(hidden_terms: list[str] | None) -> list[str] | None:
    return [t for t in (hidden_terms or []) if isinstance(t, str) and t.strip()][:20] or None


async def _check_and_store(
    index_html: str, catalogue_yaml: str | None, hidden_terms: list[str] | None, tool_context: Any
) -> dict:
    """Run the gates and the browser check, store a version, park the screenshots for the model."""
    owner = caller_uid_or_none(tool_context)
    draft_id = _draft_id(tool_context)
    if owner is None or draft_id is None:
        return {"ok": False, "refused": "No signed-in teacher or conversation for this draft; it was not stored."}

    from db.sim_drafts import add_version, get_draft

    current = await asyncio.to_thread(get_draft, draft_id, owner)
    next_version = int((current or {}).get("latestVersion") or 0) + 1
    _progress(tool_context, "simChecking", f"Checking version {next_version} in the browser…", version=next_version)
    with tempfile.TemporaryDirectory(prefix="simauthor-") as tmp:
        verdict = await verify_draft(
            index_html,
            catalogue_yaml,
            hidden_terms=_clean_terms(hidden_terms),
            browser=browser_from_env(),
            out_dir=Path(tmp),
        )
        shots = {k: base64.b64encode(p.read_bytes()).decode("ascii") for k, p in verdict.screenshots.items()}
    artefact_id = None
    m = re.search(r"\bARTEFACT_NAME\s*=\s*[\"']([^\"']+)[\"']", index_html or "")
    if m:
        artefact_id = m.group(1)[:64]

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
    _progress(
        tool_context,
        "simChecked",
        f"Version {version or next_version}: level {max(verdict.level, 0)} of 3. Looking at the screenshots…",
        version=version or next_version,
        level=max(verdict.level, 0),
    )
    return result


async def verify_sim(
    index_html: str, catalogue_yaml: str, hidden_terms: list[str] | None = None, tool_context: Any = None
) -> dict:
    """Check a COMPLETE simulation draft and keep it as a new version the teacher can see.

    Use this for the FIRST draft, or to replace the whole page. For any later
    change, use ``edit_sim``: it changes only what needs to change, which is much
    faster. It runs the platform's real gates, then opens the page in a real
    browser: the self-test, fit at 390 and 700 px, whether pressing start moves
    the drawing, and the events it emits when clicked through. Screenshots of the
    page are attached to this result: LOOK at them, and check that what is drawn
    agrees with the physics at that moment (positions, which parts move,
    directions).

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
    if (refusal := _spend_check(tool_context)) is not None:
        return refusal
    return await _check_and_store(index_html, catalogue_yaml, hidden_terms, tool_context)


async def _current_files(tool_context: Any) -> tuple[dict | None, str | None]:
    """The latest stored version's files for this conversation, or (None, why not)."""
    owner = caller_uid_or_none(tool_context)
    draft_id = _draft_id(tool_context)
    if owner is None or draft_id is None:
        return None, "No signed-in teacher or conversation."
    from db.sim_drafts import get_draft, get_version

    draft = await asyncio.to_thread(get_draft, draft_id, owner)
    n = int((draft or {}).get("latestVersion") or 0)
    if not n:
        return None, "There is no draft yet in this conversation: write the first one with verify_sim."
    doc = await asyncio.to_thread(get_version, draft_id, n, owner)
    if not doc:
        return None, "The latest version could not be read."
    return {"index.html": doc.get("html") or "", "catalogue.yaml": doc.get("yaml") or "", "version": n}, None


async def read_sim(
    file: str = "index.html",
    start_line: int = 1,
    end_line: int = 200,
    search: str | list[str] | None = None,
    tool_context: Any = None,
) -> dict:
    """Read the CURRENT stored draft, with line numbers, before you edit it.

    Look up EVERYTHING you need for a change in ONE call: pass a list of search
    terms (e.g. ["bob", "drawRuler", "strings = {"]). Every call is a round trip,
    and several small reads are the slowest part of an edit.

    The draft may have changed since you last wrote it (earlier edits), so look
    up the exact text here and copy it into ``edit_sim``'s ``find``.

    Args:
        file: ``index.html`` or ``catalogue.yaml``.
        start_line: First line to show (1-based).
        end_line: Last line to show (at most 400 lines per call).
        search: Instead of a range, show every line containing this text, or any
            of these texts (case-insensitive), with two lines of context.

    Returns:
        ``version``, ``total_lines`` and ``lines`` as "number: text".
    """
    files, why = await _current_files(tool_context)
    if files is None:
        return {"ok": False, "refused": why}
    if file not in ("index.html", "catalogue.yaml"):
        return {"ok": False, "refused": "file must be index.html or catalogue.yaml"}
    lines = files[file].split("\n")
    if search:
        needles = [t.lower() for t in ([search] if isinstance(search, str) else search) if isinstance(t, str) and t]
        keep: set[int] = set()
        for i, line in enumerate(lines):
            low = line.lower()
            if any(n in low for n in needles):
                keep.update(range(max(0, i - 2), min(len(lines), i + 3)))
        shown = [f"{i + 1}: {lines[i]}" for i in sorted(keep)][:400]
    else:
        a = max(1, int(start_line))
        b = min(len(lines), int(end_line), a + 399)
        shown = [f"{i}: {lines[i - 1]}" for i in range(a, b + 1)]
    return {"ok": True, "version": files["version"], "file": file, "total_lines": len(lines), "lines": "\n".join(shown)}


async def edit_sim(
    edits: list[dict],
    file: str = "index.html",
    hidden_terms: list[str] | None = None,
    tool_context: Any = None,
) -> dict:
    """Change the current draft with targeted edits, then check it and keep it as a new version.

    Use this for every change after the first draft: it is much faster than
    rewriting the page. Each edit replaces one exact piece of text. Look the text
    up with ``read_sim`` first: ``find`` must match the current file EXACTLY
    (spaces and line breaks included) and occur exactly once — include enough
    surrounding text to make it unique. Edits apply in order; if any fails,
    nothing is changed. Screenshots of the result are attached, as with
    ``verify_sim``.

    Args:
        edits: A list of {"find": "<exact current text>", "replace": "<new text>"}.
        file: ``index.html`` or ``catalogue.yaml``.
        hidden_terms: As for ``verify_sim``; pass them every time.

    Returns:
        As ``verify_sim``, plus ``applied`` (the number of edits).
    """
    files, why = await _current_files(tool_context)
    if files is None:
        return {"ok": False, "refused": why}
    if file not in ("index.html", "catalogue.yaml"):
        return {"ok": False, "refused": "file must be index.html or catalogue.yaml"}
    if not isinstance(edits, list) or not edits:
        return {"ok": False, "refused": "edits must be a non-empty list of {find, replace}"}
    _progress(
        tool_context, "simEditing", f"Applying {len(edits)} edit(s) to version {files['version']}…", count=len(edits)
    )
    text = files[file]
    for i, edit in enumerate(edits, 1):
        find = edit.get("find") if isinstance(edit, dict) else None
        replace = edit.get("replace") if isinstance(edit, dict) else None
        if not isinstance(find, str) or not find or not isinstance(replace, str):
            return {
                "ok": False,
                "refused": f"edit {i}: needs a non-empty 'find' and a 'replace' string; nothing changed",
            }
        count = text.count(find)
        if count != 1:
            hint = (
                "not found — read_sim the current text and copy it exactly"
                if count == 0
                else (f"found {count} times — add surrounding text so it is unique")
            )
            return {"ok": False, "refused": f"edit {i}: 'find' {hint}; nothing changed"}
        text = text.replace(find, replace, 1)
    if (refusal := _spend_check(tool_context)) is not None:
        return refusal
    html = text if file == "index.html" else files["index.html"]
    yml = text if file == "catalogue.yaml" else files["catalogue.yaml"]
    result = await _check_and_store(html, yml, hidden_terms, tool_context)
    result["applied"] = len(edits)
    result["edited_from_version"] = files["version"]
    return result


async def read_reference(topic: str, tool_context: Any = None) -> str:
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
    if name is not None:
        _progress(tool_context, "simReading", f"Reading the {topic} guide…", topic=topic)
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
        if fr is not None and fr.name in SCREENSHOT_TOOLS:
            fr.parts = [
                types.FunctionResponsePart.from_bytes(data=base64.b64decode(s), mime_type="image/png") for s in shots
            ]
            return True
    logger.warning("sim screenshots parked but no verify_sim response in the request; dropped")
    return False
