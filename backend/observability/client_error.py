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

#: What produced the error. A closed enum — never free text.
KINDS = ("render", "window.onerror", "unhandledrejection")

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
) -> None:
    """Emit one browser-side error. **Never raises.**

    Also writes a single stdlib warning line unconditionally. That is not
    redundancy: in LOCAL_MODE and under ``make dev`` there is no named Cloud
    Logging logger, so without it a client error stays invisible to the very
    developer who just caused it.

    ``user_agent`` comes from the request header, not from the body — a field the
    caller cannot choose is worth more than one it can, on an endpoint with no
    auth.
    """
    kind = kind if kind in KINDS else "render"
    role = role if role in ROLES else "anon"
    message = redact(message)[:MAX_MESSAGE_CHARS]
    stack = redact(stack)[:MAX_STACK_CHARS]
    path = clean_url(url)

    # Unconditional, and first: if the structured emit below is a no-op (local
    # dev, no creds), this line is the only visibility there is.
    logger.warning(
        "client_error: kind=%s role=%s path=%s message=%s",
        kind,
        role,
        path or "-",
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


__all__ = [
    "KINDS",
    "LOG_ID_CLIENT_ERROR",
    "MAX_MESSAGE_CHARS",
    "MAX_STACK_CHARS",
    "MAX_URL_CHARS",
    "ROLES",
    "clean_url",
    "emit_client_error",
    "redact",
    "surface_of",
]
