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
SCREENSHOT_TOOLS = frozenset({"verify_sim", "edit_sim", "check_sim", "describe_sim"})
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
    "physics-helper": "physics-helper.md",
    "plots": "plots.md",
    "collisions": "collisions.md",
}
_HASH_RE = re.compile(r"sha384-HASH:([A-Za-z0-9._-]+)")


def _with_vendor_hashes(text: str) -> str:
    """Fill ``sha384-HASH:<file>`` in a guide from vendor.json, so a guide can never
    hand the model a stale hash. An unknown file is left visible, never guessed."""
    if "sha384-HASH:" not in text:
        return text
    import json

    from sim_gates import BACKEND_COPIES, REPO_ROOT

    manifest = REPO_ROOT / "infrastructure" / "mcp-sandbox" / "vendor.json"
    if not manifest.is_file():
        manifest = BACKEND_COPIES / "vendor.json"
    libs = json.loads(manifest.read_text()).get("libraries", {})
    hashes = {name: spec["sha384"] for lib in libs.values() for name, spec in lib.get("files", {}).items()}
    return _HASH_RE.sub(lambda m: f"sha384-{hashes[m.group(1)]}" if m.group(1) in hashes else m.group(0), text)


def _scoped(key: str, ctx: Any) -> str:
    inv = getattr(getattr(ctx, "_invocation_context", None), "invocation_id", None)
    return f"{key}:{inv}" if isinstance(inv, str) and inv else key


def _session_id(ctx: Any) -> str | None:
    session = getattr(getattr(ctx, "_invocation_context", None), "session", None)
    sid = getattr(session, "id", None)
    return sid if isinstance(sid, str) and sid else None


def _draft_id(ctx: Any) -> str | None:
    sid = _session_id(ctx)
    return re.sub(r"[^A-Za-z0-9_-]", "_", sid)[:128] if sid else None


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


NOT_ENABLED = (
    "The Sim workshop is not switched on for this teacher. Tell them, in their language, "
    "that a researcher can switch it on for them, and do not try to build anything."
)


def _not_enabled(tool_context: Any) -> dict | None:
    """The refusal for a teacher without the Sim workshop feature, else None."""
    from auth.features import SIM_WORKSHOP, has_feature_for_uid

    return (
        None
        if has_feature_for_uid(caller_uid_or_none(tool_context), SIM_WORKSHOP)
        else {
            "ok": False,
            "refused": NOT_ENABLED,
        }
    )


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


async def _verify_and_store(
    index_html: str,
    catalogue_yaml: str | None,
    hidden_terms: list[str] | None,
    *,
    owner: str,
    draft_id: str,
    session_id: str | None,
) -> tuple[Any, dict[str, str], int | None]:
    """Run the gates and the browser check and store the result as the draft's next
    version: (verdict, screenshots as base64, version number or None if not stored)."""
    from db.sim_drafts import add_version

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
            hidden_terms=_clean_terms(hidden_terms),
            session_id=session_id,
        )
    except Exception as exc:  # storage failing must not hide the verdict
        logger.warning("sim draft not stored: %s", type(exc).__name__)
        version = None
    return verdict, shots, version


async def import_draft(index_html: str, catalogue_yaml: str | None, *, owner: str) -> dict:
    """Bring a sim made elsewhere (a workshop download, a portable file) in as a NEW
    draft: checked like any version, and given a conversation of its own, so the
    teacher can open it in the assistant and carry on.

    The draft id doubles as that conversation's id (as for every draft the
    assistant starts), so the assistant's read/edit tools find this draft.
    """
    import uuid

    draft_id = str(uuid.uuid4())
    verdict, _shots, version = await _verify_and_store(
        index_html, catalogue_yaml, None, owner=owner, draft_id=draft_id, session_id=draft_id
    )
    if version is None:
        raise RuntimeError("the imported draft could not be stored")
    return {"draftId": draft_id, "version": version, "level": verdict.level, "reasons": verdict.reasons}


async def _check_and_store(
    index_html: str, catalogue_yaml: str | None, hidden_terms: list[str] | None, tool_context: Any
) -> dict:
    """Run the gates and the browser check, store a version, park the screenshots for the model."""
    owner = caller_uid_or_none(tool_context)
    draft_id = _draft_id(tool_context)
    if owner is None or draft_id is None:
        return {"ok": False, "refused": "No signed-in teacher or conversation for this draft; it was not stored."}

    from db.sim_drafts import get_draft

    current = await asyncio.to_thread(get_draft, draft_id, owner)
    next_version = int((current or {}).get("latestVersion") or 0) + 1
    _progress(tool_context, "simChecking", f"Checking version {next_version} in the browser…", version=next_version)
    verdict, shots, version = await _verify_and_store(
        index_html,
        catalogue_yaml,
        hidden_terms,
        owner=owner,
        draft_id=draft_id,
        session_id=_session_id(tool_context),
    )

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


async def check_sim(hidden_terms: list[str] | None = None, tool_context: Any = None) -> dict:
    """Check the CURRENT stored draft again, without changing or resending it.

    Use this to look at a draft you did not just write: one the teacher imported,
    or one from an earlier conversation. It runs the same gates and browser check
    as ``verify_sim`` on the stored files and attaches the screenshots, but stores
    no new version. Never resend the whole page through ``verify_sim``, or make an
    edit that changes nothing, just to see a check: both are slow, and a no-op
    edit leaves the teacher a version identical to the last.

    Args:
        hidden_terms: What the student must work out and must NOT see, as for
            ``verify_sim``.

    Returns:
        The same verdict as ``verify_sim``, for the ``version`` that is current.
    """
    if (refusal := _not_enabled(tool_context) or _spend_check(tool_context)) is not None:
        return refusal
    files, why = await _current_files(tool_context)
    if files is None:
        return {"ok": False, "refused": why}
    version = files["version"]
    _progress(tool_context, "simChecking", f"Checking version {version} in the browser…", version=version)
    with tempfile.TemporaryDirectory(prefix="simcheck-") as tmp:
        verdict = await verify_draft(
            files["index.html"],
            files["catalogue.yaml"] or None,
            hidden_terms=_clean_terms(hidden_terms),
            browser=browser_from_env(),
            out_dir=Path(tmp),
        )
        shots = {k: base64.b64encode(p.read_bytes()).decode("ascii") for k, p in verdict.screenshots.items()}
    model_shots = [shots[k] for k in MODEL_SHOTS if k in shots]
    park_screenshots(tool_context, model_shots)
    result = verdict.for_model()
    result.update(draft_id=_draft_id(tool_context), version=version, stored=False)
    if not model_shots:
        result["note"] = "No screenshots: the browser check did not run, so nothing above level 1 is known."
    _progress(
        tool_context,
        "simChecked",
        f"Version {version}: level {max(verdict.level, 0)} of 3. Looking at the screenshots…",
        version=version,
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
    if (refusal := _not_enabled(tool_context) or _spend_check(tool_context)) is not None:
        return refusal
    return await _check_and_store(index_html, catalogue_yaml, hidden_terms, tool_context)


async def _current_files(tool_context: Any, version: int = 0) -> tuple[dict | None, str | None]:
    """The latest stored version's files for this conversation (or an earlier
    ``version``), or (None, why not). ``latest`` is always the newest number."""
    owner = caller_uid_or_none(tool_context)
    draft_id = _draft_id(tool_context)
    if owner is None or draft_id is None:
        return None, "No signed-in teacher or conversation."
    from db.sim_drafts import get_draft, get_version

    draft = await asyncio.to_thread(get_draft, draft_id, owner)
    latest = int((draft or {}).get("latestVersion") or 0)
    if not latest:
        return None, "There is no draft yet in this conversation: write the first one with verify_sim."
    n = int(version or 0) or latest
    if not 1 <= n <= latest:
        return None, f"There is no version {n}: the versions are 1 to {latest}."
    doc = await asyncio.to_thread(get_version, draft_id, n, owner)
    if not doc:
        return None, f"Version {n} could not be read."
    files = {"index.html": doc.get("html") or "", "catalogue.yaml": doc.get("yaml") or "", "version": n}
    return files | {"latest": latest}, None


async def read_sim(
    file: str = "index.html",
    start_line: int = 1,
    end_line: int = 200,
    search: str | list[str] | None = None,
    version: int = 0,
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
        version: An EARLIER stored version to read, e.g. when the teacher wants
            back what version 2 had. 0 (the default) is the current one. Edits
            always apply to the current version.

    Returns:
        ``version``, ``total_lines`` and ``lines`` as "number: text". Reads of a
        version that has since been replaced are shortened to a note in later
        calls: read again for the current text rather than relying on them.
    """
    if (refusal := _not_enabled(tool_context)) is not None:
        return refusal
    files, why = await _current_files(tool_context, version)
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
    out = {"ok": True, "version": files["version"], "file": file, "total_lines": len(lines), "lines": "\n".join(shown)}
    if files["version"] != files["latest"]:
        out["note"] = (
            f"This is version {files['version']}; the current one is {files['latest']}, and edits apply to it."
        )
    return out


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
    if (refusal := _not_enabled(tool_context)) is not None:
        return refusal
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
            the frame). ``physics-helper`` — the tested helper library every moving
            sim should load: the fixed-step loop, RK4/Verlet, exact collisions,
            measurement noise, Danish number format. ``plots`` — live graphs with
            uPlot. ``collisions`` — when to use matter.js (stacking, friction,
            ramps, many bodies) and how. ``anatomy-kit`` — how to draw the
            apparatus as a crafted isometric figure, with a worked example.

    Returns:
        The reference text.
    """
    name = _REFERENCE_FILES.get((topic or "").strip().lower())
    if name is not None:
        _progress(tool_context, "simReading", f"Reading the {topic} guide…", topic=topic)
    if name is None:
        return f"Unknown topic {topic!r}. Topics: {', '.join(sorted(_REFERENCE_FILES))}."
    return _with_vendor_hashes((REFERENCES / name).read_text(encoding="utf-8"))


async def record_sim_usage(callback_context: Any, llm_response: Any) -> None:
    """After each sim-author model call: add its tokens and estimated cost to the
    draft, so the workshop can show what a simulation has cost so far.

    Priced with the same function the spend gate uses. Thinking tokens are billed
    as output and counted here. Partial streamed chunks are skipped, so a call is
    counted once. Fail-open: a rough guide must never break a turn.

    Also logs one ``sim usage:`` line per call, with how much of the prompt came
    from a cache: until 2026-11-19 nothing recorded it, so whether Gemini's
    caching was helping a long build could not be told (see ADK_CONTEXT_CACHE).
    """
    try:
        if getattr(llm_response, "partial", False):
            return
        usage = getattr(llm_response, "usage_metadata", None)
        if usage is None:
            return
        tokens_in = int(getattr(usage, "prompt_token_count", 0) or 0)
        tokens_out = int(getattr(usage, "candidates_token_count", 0) or 0)
        tokens_thinking = int(getattr(usage, "thoughts_token_count", 0) or 0)
        tokens_cached = int(getattr(usage, "cached_content_token_count", 0) or 0)
        if not (tokens_in or tokens_out or tokens_thinking):
            return
        logger.info(
            "sim usage: session=%s in=%d cached=%d out=%d thinking=%d model=%s",
            _session_id(callback_context),
            tokens_in,
            tokens_cached,
            tokens_out,
            tokens_thinking,
            getattr(llm_response, "model_version", None),
        )
        owner = caller_uid_or_none(callback_context)
        draft_id = _draft_id(callback_context)
        if owner is None or draft_id is None:
            return
        from observability.llm_metrics import estimate_cost

        model = getattr(llm_response, "model_version", None) or "gemini-3.8-flash"
        cost = estimate_cost(str(model), tokens_in, tokens_out + tokens_thinking)
        from db.sim_drafts import add_usage

        await asyncio.to_thread(
            add_usage,
            draft_id=draft_id,
            owner_uid=owner,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            tokens_thinking=tokens_thinking,
            tokens_cached=tokens_cached,
            cost_usd=cost,
            session_id=_session_id(callback_context),
        )
    except Exception:
        logger.debug("sim usage not recorded", exc_info=True)


def park_screenshots(tool_context: Any, shots_b64: list[str]) -> None:
    """Hand screenshots (base64 PNG) to the next model call, inside this tool's
    response (``attach_sim_screenshots``). Also used by the activity co-pilot's
    ``describe_sim``, so it can look at the sim it is planning a lesson around."""
    if tool_context is not None and shots_b64:
        tool_context.state[_scoped(SHOTS_KEY, tool_context)] = list(shots_b64)


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
            # A COPY on this request's part: ADK shares function_response with the
            # stored session event, so assigning fr.parts wrote every check's
            # screenshots into the history, re-sent on every later call while the
            # session stayed cached (found 2026-11-19).
            part.function_response = fr.model_copy(
                update={
                    "parts": [
                        types.FunctionResponsePart.from_bytes(data=base64.b64decode(s), mime_type="image/png")
                        for s in shots
                    ]
                }
            )
            return True
    logger.warning("sim screenshots parked but no verify_sim response in the request; dropped")
    return False


#: A function response's version, by tool: read_sim reports what it read,
#: verify_sim and edit_sim what they stored.
_VERSIONED_TOOLS = frozenset({"read_sim", "verify_sim", "edit_sim", "check_sim"})
_LINE_NO = re.compile(r"^(\d+): ", re.M)


def _stub_for_read(resp: dict, latest: int) -> dict:
    """What an out-of-date read_sim result is shortened to: where it was, not what."""
    nums = [int(n) for n in _LINE_NO.findall(str(resp.get("lines") or ""))]
    where = f"lines {min(nums)}-{max(nums)} of " if nums else ""
    return {
        "ok": True,
        "version": resp.get("version"),
        "file": resp.get("file"),
        "pruned": (
            f"Read {where}{resp.get('file')} version {resp.get('version')}, since replaced by version {latest}. "
            "Its text is left out to keep the conversation small: call read_sim again for the current text."
        ),
    }


async def prune_stale_sim_reads(callback_context: Any, llm_request: Any) -> int:
    """Shorten tool results the model no longer needs, before each model call.

    A sim build re-sends its whole history on every call. On 2026-11-19 one
    conversation made 39 calls, about 50k input tokens each, mostly ``read_sim``
    slices of a 200 KB sim, several of versions already replaced: copies the
    model must also reason AROUND, since they contradict the current file.

    - a ``read_sim`` result of a version older than the newest one in the request
      becomes a one-line note (where it read, not what);
    - a ``read_reference`` guide read more than once is kept only the last time.

    Only function RESPONSES are touched, never the model's own function calls
    (Gemini 3 signs those), and only in this request: the stored session keeps
    everything, and ``read_sim(version=N)`` can still read any version. The
    result depends only on the request, so it is stable from call to call until
    a new version appears (which keeps a context cache valid meanwhile).
    Returns how many results were shortened. Fail-open.
    """
    import os

    if os.environ.get("SIM_PRUNE_STALE_READS", "1").strip() == "0":  # ops off-switch
        return 0
    try:
        contents = getattr(llm_request, "contents", None) or []
        # Parts, not their function_response: the request's parts are its own
        # shallow copies, but function_response is SHARED with the stored session
        # event. Replacing part.function_response is safe; editing it is not.
        parts = [
            part
            for content in contents
            for part in (content.parts or [])
            if getattr(part, "function_response", None) is not None
        ]

        def resp_of(part: Any) -> dict | None:
            r = part.function_response.response
            return r if isinstance(r, dict) else None

        versions = [
            int(r["version"])
            for part in parts
            if part.function_response.name in _VERSIONED_TOOLS
            and (r := resp_of(part)) is not None
            and isinstance(r.get("version"), int)
        ]
        latest = max(versions, default=0)
        last_guide: dict[str, int] = {}
        for i, part in enumerate(parts):
            if part.function_response.name == "read_reference" and (r := resp_of(part)) is not None:
                last_guide[str(r.get("result", r))[:200]] = i
        pruned = 0
        for i, part in enumerate(parts):
            fr = part.function_response
            resp = resp_of(part)
            if resp is None or resp.get("pruned"):
                continue
            stub = None
            if fr.name == "read_sim" and isinstance(resp.get("version"), int) and resp["version"] < latest:
                stub = _stub_for_read(resp, latest)
            elif fr.name == "read_reference" and last_guide.get(str(resp.get("result", resp))[:200]) != i:
                stub = {"pruned": "The same guide is read again later in this conversation."}
            if stub is not None:
                part.function_response = fr.model_copy(update={"response": stub})
                pruned += 1
        if pruned:
            logger.info("sim prune: %d stale result(s) shortened, newest version %d", pruned, latest)
        return pruned
    except Exception:
        logger.debug("sim prune failed; request left as it was", exc_info=True)
        return 0
