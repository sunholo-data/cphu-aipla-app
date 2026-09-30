"""Client-side error sink (1.1.96 M-1) → Cloud Logging.

Until this module existed, **a JavaScript exception in a teacher's browser was
invisible to us**. The backend has OTel → Cloud Trace/Logging/BigQuery and is
well instrumented; the client had no error reporting dependency, no global error
boundary, no ``window.onerror`` and no ``unhandledrejection`` handler. So the
standing answer to "the UI is difficult" had to be a guess, on the one surface
with no instrumentation — the same silent-failure class the retrospective named
as this project's signature bug.

Design (docs/design/aipla/v1.1.0-feedback/teacher-ui-friction-telemetry.md, M-1):
  * **No new vendor.** No Sentry, no PostHog, no third-party processor added to a
    compliance picture that is already the project's binding constraint. We POST
    to our own backend and log to Cloud Logging, inside the GCP project
    (ADR-008 / Axiom #9).
  * **No identity.** Not a uid, not an email, not a group code. Only a
    three-valued ``role`` hint, which identifies nobody. This is precisely why
    M-1 needs no consent decision where M0's friction events do — if this ever
    grows a uid, it inherits M0's "tell teachers" gate.
  * **Redaction is defence in depth.** The browser redacts before sending; we
    redact again here, because the endpoint is unauthenticated and a client that
    failed to redact is exactly the broken client we are trying to hear from.

Sink shape copies ``chat_log`` — a named ``google.cloud.logging`` logger, because
the Log Router routes by ``logName``. Note that ``aipla_client_error`` is
deliberately **NOT** in the chat-logs sink filter
(``infrastructure/modules/chat-logs/variables.tf`` allowlists
``aipla_(chat_turn|workbench_event|voice_cost|rubric_run)``), so these rows land
in Cloud Logging and stop there. M-1 is scoped to Cloud Logging; routing errors
to BigQuery is a later, deliberate decision — not an accident of naming.

Query them with::

    gcloud logging read 'logName:"aipla_client_error"' \\
      --project=aipla-dev-2026 --limit=50 --format=json
"""

from __future__ import annotations

import logging
import re
from typing import Any

from observability.chat_log import _get_logger, _version_fields

logger = logging.getLogger(__name__)

# Log id — deliberately absent from the chat-logs sink filter (see module docstring).
LOG_ID_CLIENT_ERROR = "aipla_client_error"

# Hard caps. A truncated report beats no report, so oversize is trimmed, never
# rejected — the browser that sends a 40 KB stack is the one in trouble.
MAX_MESSAGE_CHARS = 500
MAX_STACK_CHARS = 4000
MAX_URL_CHARS = 300

#: What produced the report. A closed enum — never free text. ``recovered`` is
#: not an error: it is the page an automatic stale-deploy reload landed on,
#: saying it rendered (1.1.138 M0).
KINDS = ("render", "window.onerror", "unhandledrejection", "recovered")

#: A build id is an opaque build stamp (``b20260929101500-k3x9``, a SHA, a tag).
#: Anything else is dropped rather than logged: this field arrives on an
#: unauthenticated endpoint and must not become a free-text channel.
_BUILD_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

#: Who was looking at it. Three-valued, identifies nobody.
ROLES = ("teacher", "student", "anon")

_REDACTED = "[redacted]"

# Ordered: the JWT pattern must run before the generic bearer pattern so a
# "Bearer eyJ…" collapses to one marker rather than two nested ones.
_REDACTIONS: tuple[tuple[re.Pattern[str], str], ...] = (
    # A JWT — the group token and the Firebase token both look like this.
    (re.compile(r"eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"), _REDACTED),
    (re.compile(r"[Bb]earer\s+[A-Za-z0-9._~+/=-]{8,}"), f"Bearer {_REDACTED}"),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), _REDACTED),
    # A query string anywhere inside the text. Join links are `…/group?code=XXXX`
    # and a stack frame quoting one would put live class join codes in the log.
    # Requires a `key=` so it matches an actual query string: a bare `?` is
    # ordinary prose ("what happened?") and redacting it only mangles the
    # message we are trying to read.
    (re.compile(r"\?[A-Za-z0-9_\-%.+\[\]]*=[^\s]*"), f"?{_REDACTED}"),
)


def redact(text: str) -> str:
    """Strip credentials, email addresses and query strings from free text.

    Applied to the message and the stack. Not a guarantee — an exception message
    can quote anything — but it removes the categories we can actually name, and
    it runs on both sides of the wire.
    """
    if not text:
        return ""
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


def clean_url(raw: str) -> str:
    """Reduce a reported URL to its **path only**.

    Query strings and hash fragments are dropped, not redacted: there is nothing
    in either that helps triage, and the join link (``…/group?code=XXXX``) means
    the query string is the single highest-risk field the browser could send.
    """
    if not raw:
        return ""
    path = raw.split("?", 1)[0].split("#", 1)[0]
    return path[:MAX_URL_CHARS]


def clean_build_id(raw: str | None) -> str | None:
    """A well-formed build id, or ``None``. Never the raw value on a mismatch."""
    if not raw or not isinstance(raw, str):
        return None
    raw = raw.strip()
    return raw if _BUILD_ID.match(raw) else None


def surface_of(path: str) -> str:
    """The first path segment — ``teacher``, ``lessons``, ``project``, ``chat``.

    Answers "which surface breaks" without a join, which is the first question
    anyone asks of this log and the one M1's funnel will refine.
    """
    segments = [s for s in path.split("/") if s]
    return segments[0][:64] if segments else "root"


def emit_client_error(
    *,
    kind: str,
    message: str,
    stack: str = "",
    url: str = "",
    role: str = "anon",
    user_agent: str = "",
    build_id: str | None = None,
    auto_reloaded: bool | None = None,
    after_auto_reload: bool | None = None,
    previous_build_id: str | None = None,
) -> None:
    """Emit one browser-side error. **Never raises.**

    Also writes a single stdlib warning line unconditionally. That is not
    redundancy: in LOCAL_MODE and under ``make dev`` there is no named Cloud
    Logging logger, so without it a client error stays invisible to the very
    developer who just caused it.

    ``user_agent`` comes from the request header, not from the body — a field the
    caller cannot choose is worth more than one it can, on an endpoint with no
    auth.

    ``build_id`` / ``auto_reloaded`` / ``after_auto_reload`` /
    ``previous_build_id`` (1.1.138 M0) tell a stale-deploy crash from a real
    bug, and a reload that cured it from one that did not. All optional: an
    older client that sends none of them still logs, with ``None`` in each.
    """
    kind = kind if kind in KINDS else "render"
    role = role if role in ROLES else "anon"
    message = redact(message)[:MAX_MESSAGE_CHARS]
    stack = redact(stack)[:MAX_STACK_CHARS]
    path = clean_url(url)
    build_id = clean_build_id(build_id)
    previous_build_id = clean_build_id(previous_build_id)

    # Unconditional, and first: if the structured emit below is a no-op (local
    # dev, no creds), this line is the only visibility there is. A recovery is
    # good news, so it does not log at warning.
    logger.log(
        logging.INFO if kind == "recovered" else logging.WARNING,
        "client_error: kind=%s role=%s path=%s build=%s auto_reloaded=%s message=%s",
        kind,
        role,
        path or "-",
        build_id or "-",
        auto_reloaded,
        message or "-",
    )

    gl = _get_logger(LOG_ID_CLIENT_ERROR)
    if gl is None:
        return
    payload: dict[str, Any] = {
        "kind": kind,
        "role": role,
        "message": message,
        "stack": stack,
        "path": path,
        "surface": surface_of(path),
        "user_agent": user_agent[:300],
        # 1.1.138 M0. `client_build_id` is the build the TAB ran; the server's
        # build is `revision` / `app_version` below. On a `recovered` row,
        # `previous_build_id` != `client_build_id` means the reload moved the
        # tab onto a new build — a real stale deploy, cured.
        "client_build_id": build_id,
        "previous_build_id": previous_build_id,
        "auto_reloaded": auto_reloaded,
        "after_auto_reload": after_auto_reload,
        # Frontend and backend ship in ONE container (the backend is a sidecar
        # inside `aipla-v01-frontend`), so the server's revision/app_version
        # describes the same build that served the broken JS. The client does not
        # need to report its own version, and cannot misreport it.
        **_version_fields(),
    }
    try:
        gl.log_struct(payload)
    except Exception as exc:  # telemetry must never break the request
        logger.warning("client_error: emit failed (suppressed): %s", exc)


# ─── Client environment beacon (screen-size slice of 1.1.96 M0, 2026-09-30) ───
#
# "The UI was a bit cramped on a laptop — what screen sizes are people using?"
# Errors are too rare to sample screens from, so the browser sends ONE of these
# per page session (and again only when the viewport crosses a width bucket).
#
# A SIBLING log id, not ``aipla_client_error``: one row per page load would
# otherwise drown the error count, and "how many client errors this week" is the
# query that log exists to answer. Same sink (Cloud Logging only, not routed to
# BigQuery — the chat-logs filter is an allowlist and this id is not on it).
#
# Privacy (ADR-001): a screen size is fine, a fingerprint is not. So this row
# carries NO user agent (the error row reads it from the header; this one never
# does), no path, no role, no id of any kind — only the coarse numbers below,
# the surface, and the client build id the error report already carries.
LOG_ID_CLIENT_ENV = "aipla_client_env"

ENV_KIND = "env"

#: Where the tab was. Derived by the client from the route prefix.
ENV_SURFACES = ("student", "teacher", "public")

#: ``(pointer: coarse)`` is a touch screen; ``fine`` is a mouse/trackpad.
ENV_POINTERS = ("coarse", "fine")

#: Upper bound for any CSS-pixel dimension. An 8K display is 7680 wide; anything
#: past this is a lying client, and it is clamped rather than rejected.
MAX_DIMENSION_PX = 10000
MIN_DPR, MAX_DPR = 0.5, 8.0

#: Width buckets — kept in lockstep with ``VIEWPORT_BUCKETS`` in
#: ``frontend/src/lib/clientEnvBeacon.ts`` and ``scripts/screen-sizes.sh``.
#: Inclusive lower bounds; the label is what gets logged.
VIEWPORT_BUCKETS: tuple[tuple[int, str], ...] = (
    (0, "<768"),
    (768, "768-1279"),
    (1280, "1280-1439"),
    (1440, "1440-1919"),
    (1920, ">=1920"),
)


def _is_number(raw: Any) -> bool:
    return not isinstance(raw, bool) and isinstance(raw, (int, float)) and raw == raw  # NaN != NaN


def clamp_dimension(raw: Any) -> int | None:
    """A CSS-pixel dimension as an int in ``[0, MAX_DIMENSION_PX]``, or ``None``."""
    if not _is_number(raw):
        return None
    return int(max(0, min(MAX_DIMENSION_PX, round(raw))))


def clamp_dpr(raw: Any) -> float | None:
    """Device pixel ratio in ``[MIN_DPR, MAX_DPR]`` to two decimals, or ``None``."""
    if not _is_number(raw) or raw <= 0:
        return None
    return round(max(MIN_DPR, min(MAX_DPR, float(raw))), 2)


def viewport_bucket(width: int | None) -> str | None:
    """The width bucket label for ``width``, or ``None`` when width is unknown."""
    if width is None:
        return None
    label = VIEWPORT_BUCKETS[0][1]
    for lower, name in VIEWPORT_BUCKETS:
        if width >= lower:
            label = name
    return label


def emit_client_env(
    *,
    viewport_w: Any = None,
    viewport_h: Any = None,
    screen_w: Any = None,
    screen_h: Any = None,
    dpr: Any = None,
    pointer: Any = None,
    surface: Any = None,
    build_id: str | None = None,
) -> None:
    """Emit one client-environment row. Clamps everything; **never raises**.

    Deliberately has no parameter for a user agent, path, role or id: a field
    that cannot be passed cannot leak. Logs to stdlib at DEBUG only (one line per
    page load would be noise under ``make dev``).
    """
    try:
        vw = clamp_dimension(viewport_w)
        payload: dict[str, Any] = {
            "kind": ENV_KIND,
            "viewport_w": vw,
            "viewport_h": clamp_dimension(viewport_h),
            "screen_w": clamp_dimension(screen_w),
            "screen_h": clamp_dimension(screen_h),
            "dpr": clamp_dpr(dpr),
            "pointer": pointer if pointer in ENV_POINTERS else None,
            "surface": surface if surface in ENV_SURFACES else "unknown",
            "viewport_bucket": viewport_bucket(vw),
            "client_build_id": clean_build_id(build_id),
            **_version_fields(),
        }
        logger.debug("client_env: %s", payload)
        gl = _get_logger(LOG_ID_CLIENT_ENV)
        if gl is None:
            return
        gl.log_struct(payload)
    except Exception as exc:  # telemetry must never break the request
        logger.warning("client_env: emit failed (suppressed): %s", exc)


__all__ = [
    "ENV_KIND",
    "ENV_POINTERS",
    "ENV_SURFACES",
    "KINDS",
    "LOG_ID_CLIENT_ENV",
    "LOG_ID_CLIENT_ERROR",
    "MAX_DIMENSION_PX",
    "MAX_MESSAGE_CHARS",
    "MAX_STACK_CHARS",
    "MAX_URL_CHARS",
    "ROLES",
    "VIEWPORT_BUCKETS",
    "clamp_dimension",
    "clamp_dpr",
    "clean_build_id",
    "clean_url",
    "emit_client_env",
    "emit_client_error",
    "redact",
    "surface_of",
    "viewport_bucket",
]
