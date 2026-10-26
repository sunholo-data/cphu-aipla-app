"""``ResilientLlm``: retry, then fail over, on the BaseLlm seam (1.1.142 M1+M2).

**Ported down from ``sunholo-data/platform-source``** (``upstream/dev`` @
``c928fca6`` = ``main`` @ ``b322f55d`` + #14), MODEL-RELIABILITY M3.
Not merged — adapted per file (CLAUDE.md "Upstream tracking"). The decision
logic is upstream's; the AIPLA differences are listed at the bottom of this
docstring and each one has a reason.

What it does. Wraps an ordered chain of resolved ``BaseLlm`` instances
(primary first). On a classified failure (``adk.model_errors``) it retries
transient errors (429 **and** 5xx, and first-token stalls) with capped
full-jitter backoff, honouring a provider retry-after up to its cap, then moves
down the chain — but ONLY while no *visible* output (non-thought content) has
reached the consumer. After that, re-running the turn would show the student a
second answer spliced onto the first, so it raises a typed ``ModelTurnError``
instead. Every decision emits a reliability event (``MODEL_RETRY`` /
``MODEL_FALLBACK``) through the per-request LatencyTracker queue that
``stream_agui_events`` drains, exactly like the compaction notices.

Why the motivating turn died. ``adk/quota_retry.py`` (2026-08-21) matched 429
only, so the Gemini ``500 INTERNAL`` of 2026-09-22 ended a student's turn
outright, while ``gemini-3.8-flash`` sat registered and healthy. ``quota_retry``
is gone: its 429 retry and its first-token deadline both live here now.
**Retries live in exactly ONE layer** — do not give chain members
``HttpRetryOptions`` or wrap them in another retrying class, or attempts
multiply and blow the failover budget (upstream's warning, and the reason
``quota_retry`` had to be removed rather than kept underneath).

Streaming contract. Yielded ``LlmResponse`` objects pass through as the same
objects, in the same order. The one exception is a turn answered by a model
other than the chain head: each response is stamped
``custom_metadata["served_model"]`` so the chat-log row records the model that
actually answered (``adk/callbacks/session.py``) and the cost dashboard prices
it at the smart-tier rate, plus ``custom_metadata["model_route"]`` naming why
(``failover`` / ``escalation`` / ``opt_in``, ``adk/model_routing.py``).
ag_ui_adk's translator ignores ``custom_metadata``.

Pre-routing (1.1.142 M3). With ``escalation_index`` set (the platform default
only — ``adk.agent._escalation_index_for``), a turn whose CURRENT student
message carries an image, or any turn of an activity with ``modelTier: smart``,
starts on ``chain[escalation_index]`` with the rest of the chain behind it. The
escalated primary's first-token deadline is the budget less
``ESCALATION_FALLBACK_RESERVE_S`` and it gets no stall retry, so a smart-tier
stall still leaves the default time to answer.

AIPLA adaptations, and why:

* **A wall-clock budget** (``FAILOVER_BUDGET_SECONDS``, < 30 s). Upstream
  states the < 30 s axiom but bounds it only by retry counts. Here the client
  abandons a silent stream at 30 s (``useSkillAgent``) after ~3 s of session
  setup, so the budget is enforced on a (patchable) monotonic clock: a retry
  whose wait would overrun it falls over instead, and an attempt that would
  start past it raises.
* **The first-token deadline** moved in from ``quota_retry`` (2026-09-21: six
  prod turns sat 48-105 s on a request Vertex had accepted and gone quiet on).
  Upstream #14 already carries it (we authored it there) as ``SilentStallError``;
  the classification is upstream's, the deadline arithmetic is ours because of
  the budget. The env var keeps AIPLA's name, ``AIPLA_FIRST_TOKEN_DEADLINE_S``
  (upstream: ``MODEL_FIRST_TOKEN_DEADLINE_S``). Streaming only, before the first
  chunk only. The primary gets
  ``first_token_deadline()`` (10 s) and one stall retry; a fallback member gets
  whatever budget is left, because the smart tier's first token is ~5 s median
  and there is nothing after it to fall to.
* **Cooldown is keyed by MODEL, not provider.** Every AIPLA model is "gemini";
  benching the provider would bench the fallback with the primary.
* **Dropped:** ``schema_conformance.sanitize_function_declarations`` (it strips
  ``additional_properties``, which only the Gemini *Express Mode* endpoint
  rejects — AIPLA is Vertex-only, where the field is accepted, and no request
  here has ever 400'd on it); the cross-provider tool-history sanitizer (a
  Gemini-to-Gemini hop keeps the same id-less tool shape); ``FAULT_INJECT_MODEL``
  (a LiteLLM-based laptop probe for a ``make`` target AIPLA does not have).
  Each is a straight re-port if a non-Gemini member ever joins the chain.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from typing import Any

from google.adk.models.base_llm import BaseLlm

from adk.model_errors import (
    CODE_UNAVAILABLE,
    ErrorClass,
    MalformedFunctionCallError,
    ModelTurnError,
    SilentStallError,
    classify,
)
from adk.model_routing import (
    MODEL_ROUTE_KEY,
    ROUTE_ESCALATION,
    ROUTE_FAILOVER,
    ROUTE_OPT_IN,
    latest_student_message_has_image,
)

logger = logging.getLogger(__name__)

# Patchable seams for tests — real backoff sleeps would slow the suite, and the
# budget is only testable against a clock the test controls.
_async_sleep = asyncio.sleep
_monotonic = time.monotonic

BACKOFF_BASE_SECONDS = 0.5
BACKOFF_CAP_SECONDS = 8.0

#: Total wall-clock a turn may spend on retries + fail-over before it gives up.
#: The browser abandons a silent stream at 30 s and ~3 s of session setup has
#: already gone before the model is asked; 25 s leaves the error room to arrive.
FAILOVER_BUDGET_SECONDS = 25.0

#: A fallback attempt with less than this left is not worth starting.
MIN_ATTEMPT_SECONDS = 1.0

#: Env override for the first-token deadline (seconds). Blank/unset → the
#: default below; ``0`` disables the deadline entirely.
FIRST_TOKEN_DEADLINE_ENV = "AIPLA_FIRST_TOKEN_DEADLINE_S"

# Prod flash-lite first-token latency (v0.1.49+, 114 turns): 108 under 6.1 s,
# then 14.9, 18.1, 20.1, 36, 58, 78 s — bimodal, nothing between 6 and 15.
# 10 s sits in that gap, and 10 + a healthy ~1 s retry fits inside the client.
FIRST_TOKEN_DEADLINE_S = 10.0

#: Stall retries on the PRIMARY before falling over. One: a stall is a bad draw,
#: not a bad model, and the second draw came back in seconds every time.
MAX_STALL_RETRIES = 1

# Cooldown: after this many CONSECUTIVE abandoned turns on a model, skip it as
# primary for the window — later turns go straight to the fallback instead of
# re-paying retries during a sustained outage. Per-instance state; Cloud Run
# instances learn independently, which is acceptable at pilot scale.
COOLDOWN_THRESHOLD = 3
COOLDOWN_SECONDS = 120.0

MODEL_RETRY_EVENT = "MODEL_RETRY"
MODEL_FALLBACK_EVENT = "MODEL_FALLBACK"

#: ``LlmResponse.custom_metadata`` key naming the model that answered a
#: failed-over turn. Read by ``adk/callbacks/session.py`` for the chat-log stamp.
SERVED_MODEL_KEY = "served_model"

MODEL_ESCALATION_EVENT = "MODEL_ESCALATION"

#: An escalated turn starts on the smart tier, whose first token is ~5 s median
#: but ~20 s p90. Its first-token deadline is the budget LESS this reserve, so a
#: smart-tier stall still leaves the default model time to answer (flash-lite's
#: healthy first token is < 6.1 s on the real tutor prompt).
ESCALATION_FALLBACK_RESERVE_S = 7.0

_model_health: dict[str, dict[str, float]] = {}


def first_token_deadline() -> float | None:
    """The configured first-token deadline in seconds, or ``None`` when disabled."""
    raw = (os.environ.get(FIRST_TOKEN_DEADLINE_ENV) or "").strip()
    if not raw:
        return FIRST_TOKEN_DEADLINE_S
    try:
        value = float(raw)
    except ValueError:
        logger.warning(
            "%s=%r is not a number — using the default %.0fs", FIRST_TOKEN_DEADLINE_ENV, raw, FIRST_TOKEN_DEADLINE_S
        )
        return FIRST_TOKEN_DEADLINE_S
    return value if value > 0 else None


def reset_provider_health() -> None:
    """Test hook — clear the module-level cooldown registry."""
    _model_health.clear()


def _record_failure(model: str) -> None:
    entry = _model_health.setdefault(model, {"failures": 0, "benched_until": 0.0})
    entry["failures"] += 1
    if entry["failures"] >= COOLDOWN_THRESHOLD:
        entry["benched_until"] = _monotonic() + COOLDOWN_SECONDS
        logger.warning(
            "model %s benched for %ss after %s consecutive failures", model, COOLDOWN_SECONDS, entry["failures"]
        )


def _record_success(model: str) -> None:
    _model_health.pop(model, None)


def _is_benched(model: str) -> bool:
    entry = _model_health.get(model)
    return bool(entry) and _monotonic() < entry["benched_until"]


def _provider_of(model: Any) -> str:
    """Best-effort provider label for events (never raises)."""
    hint = getattr(model, "provider_hint", None)
    if isinstance(hint, str) and hint:
        return hint
    model_name = getattr(model, "model", "") or ""
    if model_name.startswith("gemini"):
        return "gemini"
    if "/" in model_name:
        return model_name.split("/", 1)[0]
    return type(model).__name__.lower()


def _backoff_delay(attempt: int) -> float:
    """Full jitter, capped; the floor keeps 'slept a positive amount' observable."""
    ceiling = min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * (2**attempt))
    return max(0.05, random.uniform(0, ceiling))


def _has_visible_output(response: Any) -> bool:
    """True when any non-thought part would render as answer output (text, a
    tool call, inline data). Thought parts feed the thinking panel only — a
    repeated thinking phase on retry is acceptable; repeated answer text or a
    re-issued tool call is not."""
    content = getattr(response, "content", None)
    parts = getattr(content, "parts", None) or []
    for part in parts:
        if getattr(part, "thought", False):
            continue
        if getattr(part, "text", None) or getattr(part, "function_call", None) or getattr(part, "inline_data", None):
            return True
    return False


_END = object()


def _check_generated_tool_call(response: Any) -> None:
    # Gemini's soft failure is an LlmResponse, not an exception. Passing it to
    # ADK ends the run without a reply. Regenerate before any visible output.
    if getattr(response, "error_code", None) == "MALFORMED_FUNCTION_CALL":
        raise MalformedFunctionCallError("The model generated an invalid tool call")


def _tool_call_repair_request(request: Any) -> Any:
    """A retry-local hint: do not mutate the agent's shared generation config."""
    from google.adk.models.llm_request import LlmRequest

    if not isinstance(request, LlmRequest):
        return request
    config = request.config.model_copy(deep=True)
    hint = (
        "Your previous generation was rejected as MALFORMED_FUNCTION_CALL. "
        "Generate a fresh valid tool call using exactly the declared parameter names, nesting and types. "
        "Do not output Python code or a function call as text."
    )
    instruction = config.system_instruction
    if isinstance(instruction, str):
        config.system_instruction = instruction + "\n\n" + hint
    elif isinstance(instruction, list):
        config.system_instruction = [*instruction, hint]
    else:
        from google.genai import types

        if instruction is not None and not isinstance(instruction, types.Content | types.Part):
            return request  # preserve an unfamiliar instruction representation
        parts = (
            [instruction] if isinstance(instruction, types.Part) else list(getattr(instruction, "parts", None) or [])
        )
        parts.append(types.Part.from_text(text=hint))
        config.system_instruction = types.Content(parts=parts)
    return request.model_copy(update={"config": config})


async def _close_quietly(stream: Any) -> None:
    aclose = getattr(stream, "aclose", None)
    if aclose is None:
        return
    try:
        await aclose()
    except BaseException as exc:  # a dead stream may object to closing; irrelevant now
        logger.debug("resilient_llm: aclose after stall raised %r (ignored)", exc)


def _stamp_served_model(response: Any, model: str, route: str | None = None) -> None:
    try:
        meta = dict(getattr(response, "custom_metadata", None) or {})
        meta[SERVED_MODEL_KEY] = model
        if route:
            meta[MODEL_ROUTE_KEY] = route
        response.custom_metadata = meta
    except Exception as exc:  # never break the turn on bookkeeping
        logger.debug("resilient_llm: could not stamp served_model (%s)", exc)


# --- OTel counters --------------------------------------------------------------
# Fail-open lazy init: reliability accounting must never break a turn.

_counters: dict[str, Any] = {}


def _count(name: str, model: str, code: str) -> None:
    try:
        if name not in _counters:
            from opentelemetry import metrics

            meter = metrics.get_meter("aipla.model_reliability")
            _counters[name] = meter.create_counter(name)
        _counters[name].add(1, {"model": model, "code": code})
    except Exception as exc:  # pragma: no cover
        logger.debug("otel counter %s failed (suppressed): %s", name, exc)


class ResilientLlm(BaseLlm):
    """Retry/fail-over wrapper over an ordered chain of ``BaseLlm`` models.

    ``chain[0]`` is the primary and names the wrapper (``self.model``), so ADK
    stamps ``llm_request.model`` with a ``gemini-*`` string and the built-in
    grounding tools' model checks still pass. A length-1 chain is the bare model
    plus retry and classification. ``event_sink`` is a ``(name, value) -> None``
    callable; ``None`` wires to the current request's LatencyTracker.
    """

    chain: list[Any]
    event_sink: Any = None
    max_retries_per_model: int = 2
    budget_s: float = FAILOVER_BUDGET_SECONDS
    #: Per-agent first-token deadline in seconds, overriding the env/default
    #: (``None`` = use ``first_token_deadline()``; ``0`` = no deadline). For a
    #: skill whose turns legitimately think before speaking (sim-author writes a
    #: whole simulation with thinking on); the 10 s default is tuned to tutors.
    first_token_deadline_s: float | None = None
    #: 1.1.142 M3 — chain index of the smart-tier member a hard turn starts on
    #: (``None``: this wrapper never pre-routes — a pinned model, a chain of one).
    escalation_index: int | None = None
    #: 1.1.142 M3 — the activity opted in (``modelTier: smart``): EVERY turn
    #: starts on ``chain[escalation_index]``. Set per agent build by
    #: ``adk.agent._apply_activity_model_tier``.
    opt_in_smart: bool = False

    def __init__(
        self,
        chain: list[Any],
        event_sink: Any = None,
        max_retries_per_model: int = 2,
        budget_s: float = FAILOVER_BUDGET_SECONDS,
        first_token_deadline_s: float | None = None,
        escalation_index: int | None = None,
        **kwargs: Any,
    ) -> None:
        if not chain:
            raise ValueError("ResilientLlm requires a non-empty chain")
        super().__init__(
            model=getattr(chain[0], "model", "resilient"),
            chain=chain,
            event_sink=event_sink,
            max_retries_per_model=max_retries_per_model,
            budget_s=budget_s,
            first_token_deadline_s=first_token_deadline_s,
            escalation_index=escalation_index if escalation_index is not None and escalation_index > 0 else None,
            **kwargs,
        )
        if self.escalation_index is not None and self.escalation_index >= len(chain):
            raise ValueError(f"escalation_index {self.escalation_index} is outside a chain of {len(chain)}")

    @property
    def chain_models(self) -> list[str]:
        return [getattr(m, "model", "unknown") for m in self.chain]

    # -- events ---------------------------------------------------------------

    def _emit(self, name: str, value: dict) -> None:
        try:
            if self.event_sink is not None:
                self.event_sink(name, value)
                return
            from observability.timing import get_current_tracker

            get_current_tracker().emit_reliability_event(name, value)
        except Exception as exc:  # fail-open: signalling must never break the turn
            logger.warning("reliability event emit failed (suppressed): %s", exc)

    # -- routing (1.1.142 M3) ----------------------------------------------------

    def route_for(self, llm_request: Any) -> tuple[str | None, list[Any]]:
        """``(route, order)``: why this turn leaves the default, and the members
        to try in order. ``route`` is ``None`` for an ordinary turn (order = the
        chain). An escalated / opted-in turn starts on the smart member and keeps
        the rest of the chain, in order, behind it — so a smart-tier failure
        before visible output still gets the default model's answer."""
        idx = self.escalation_index
        if idx is None:
            return None, list(self.chain)
        route: str | None = None
        if self.opt_in_smart:
            route = ROUTE_OPT_IN
        else:
            try:
                if latest_student_message_has_image(llm_request):
                    route = ROUTE_ESCALATION
            except Exception as exc:  # routing must never break a turn
                logger.debug("resilient_llm: image check failed (%s) — not escalating", exc)
        if route is None:
            return None, list(self.chain)
        order = [self.chain[idx], *(m for i, m in enumerate(self.chain) if i != idx)]
        return route, order

    # -- core -----------------------------------------------------------------

    async def generate_content_async(self, llm_request: Any, stream: bool = False):
        started = _monotonic()
        route, order = self.route_for(llm_request)
        if route is not None:
            target = getattr(order[0], "model", "unknown")
            logger.info("model route %s: %s -> %s", route, self.model, target)
            self._emit(MODEL_ESCALATION_EVENT, {"from_model": self.model, "to_model": target, "route": route})
            _count("model_escalation_total", target, route)

        def remaining() -> float:
            return self.budget_s - (_monotonic() - started)

        last_class: ErrorClass | None = None
        last_model = self.model
        last_exc: Exception | None = None

        for idx, member in enumerate(order):
            member_model = getattr(member, "model", "unknown")
            provider = _provider_of(member)
            has_next = idx + 1 < len(order)
            # Stamped only when the answer is NOT the chain head's: the chat-log
            # row then names (and prices) the model that answered, and why.
            served_route: str | None = None
            if member_model != self.model:
                served_route = route if (route is not None and idx == 0) else ROUTE_FAILOVER

            # Cooldown bench: skip a known-bad model — never the last option
            # (a benched model still beats no answer at all).
            if has_next and _is_benched(member_model):
                next_model = getattr(order[idx + 1], "model", "unknown")
                logger.info("skipping benched model %s -> %s", member_model, next_model)
                self._emit(
                    MODEL_FALLBACK_EVENT,
                    {
                        "from_model": member_model,
                        "to_model": next_model,
                        "code": CODE_UNAVAILABLE,
                        "provider": provider,
                        "reason": "model_cooldown",
                    },
                )
                _count("model_fallback_total", member_model, CODE_UNAVAILABLE)
                continue

            if idx > 0 and remaining() < MIN_ATTEMPT_SECONDS:
                break  # no time left to give the next member a fair try

            attempt = 0
            stalls = 0
            while True:
                visible = False
                try:
                    # Each member is called with ITS OWN model id. ADK stamps
                    # llm_request.model once, with the chain head; a fallback
                    # left holding that id would be asked for the wrong model
                    # (upstream's 2026-07-16 root cause).
                    if member_model and llm_request is not None:
                        try:
                            llm_request.model = member_model
                        except Exception:  # best effort — never break the turn on this
                            pass

                    gen = member.generate_content_async(llm_request, stream)
                    deadline = self._first_token_deadline(idx, stream, remaining(), escalated=route is not None)
                    if deadline is not None:
                        try:
                            first = await asyncio.wait_for(gen.__anext__(), timeout=deadline)
                        except StopAsyncIteration:
                            first = _END
                        except TimeoutError:
                            await _close_quietly(gen)
                            raise SilentStallError(deadline, member_model) from None
                        if first is not _END:
                            if _has_visible_output(first):
                                visible = True
                            _check_generated_tool_call(first)
                            if served_route is not None:
                                _stamp_served_model(first, member_model, served_route)
                            yield first
                        else:
                            _record_success(member_model)
                            return

                    async for response in gen:
                        if not visible and _has_visible_output(response):
                            visible = True
                        _check_generated_tool_call(response)
                        if served_route is not None:
                            _stamp_served_model(response, member_model, served_route)
                        yield response
                    _record_success(member_model)
                    return
                except Exception as exc:
                    if isinstance(exc, MalformedFunctionCallError):
                        await _close_quietly(gen)
                    error_class = classify(exc)
                    last_class, last_model, last_exc = error_class, member_model, exc

                    if visible:
                        # Answer content already reached the student — a retry
                        # or fail-over would duplicate it. Fail typed instead.
                        _record_failure(member_model)
                        _count("model_error_total", member_model, error_class.code)
                        logger.warning(
                            "model %s failed AFTER visible output (%s) — not retrying, it would duplicate the answer",
                            member_model,
                            error_class.code,
                        )
                        raise ModelTurnError(error_class, last_model) from exc

                    is_stall = isinstance(exc, SilentStallError)
                    if is_stall:
                        stalls += 1
                    retry_allowed = error_class.transient and attempt < self.max_retries_per_model
                    if isinstance(exc, MalformedFunctionCallError) and attempt >= 1:
                        # One fresh generation, same configured model. Never
                        # replay a tool or keep regenerating invalid calls.
                        retry_allowed = False
                    if is_stall and (stalls > MAX_STALL_RETRIES or idx > 0 or route is not None):
                        # One stall retry on the primary; a fallback member was
                        # already given the whole remaining budget to answer in.
                        retry_allowed = False

                    if retry_allowed:
                        if isinstance(exc, MalformedFunctionCallError):
                            llm_request = _tool_call_repair_request(llm_request)
                        if is_stall:
                            # The stall already cost the deadline; just de-synchronise.
                            delay = random.uniform(0, BACKOFF_BASE_SECONDS)
                        else:
                            delay = error_class.retry_after or _backoff_delay(attempt + 1)
                        # The wait plus a minimal attempt must fit the budget;
                        # otherwise a fresh model beats waiting on this one.
                        if delay + MIN_ATTEMPT_SECONDS <= remaining():
                            attempt += 1
                            self._emit(
                                MODEL_RETRY_EVENT,
                                {
                                    "model": member_model,
                                    "attempt": attempt,
                                    "delay_s": round(delay, 2),
                                    "code": error_class.code,
                                    "provider": provider,
                                },
                            )
                            _count("model_retry_total", member_model, error_class.code)
                            logger.warning(
                                "model %s: %s (attempt %d) before first token — retrying in %.2fs",
                                member_model,
                                error_class.code,
                                attempt,
                                delay,
                            )
                            await _async_sleep(delay)
                            continue

                    if error_class.fallbackable and has_next and remaining() >= MIN_ATTEMPT_SECONDS:
                        _record_failure(member_model)
                        next_model = getattr(order[idx + 1], "model", "unknown")
                        logger.warning(
                            "model %s failed (%s, %s attempt(s)) — falling over to %s",
                            member_model,
                            error_class.code,
                            attempt + 1,
                            next_model,
                        )
                        self._emit(
                            MODEL_FALLBACK_EVENT,
                            {
                                "from_model": member_model,
                                "to_model": next_model,
                                "code": error_class.code,
                                "provider": provider,
                            },
                        )
                        _count("model_fallback_total", member_model, error_class.code)
                        break  # next chain member

                    if error_class.fallbackable:
                        _record_failure(member_model)
                    _count("model_error_total", member_model, error_class.code)
                    logger.error(
                        "model %s: %s — giving up (chain %s, %.1fs of %.0fs budget used)",
                        member_model,
                        error_class.code,
                        self.chain_models,
                        self.budget_s - remaining(),
                        self.budget_s,
                    )
                    raise ModelTurnError(error_class, last_model) from exc

        # Chain exhausted via cooldown skips, fail-overs or the budget.
        if last_class is not None:
            raise ModelTurnError(last_class, last_model) from last_exc
        raise ModelTurnError(  # pragma: no cover — every member benched, none ran
            ErrorClass(transient=False, fallbackable=False, code=CODE_UNAVAILABLE, message="all models benched"),
            last_model,
        )

    def _first_token_deadline(
        self, idx: int, stream: bool, remaining: float, *, escalated: bool = False
    ) -> float | None:
        """Seconds the next attempt may wait for its first chunk, or ``None``.

        Streaming only: a non-streamed call's single response IS the whole
        answer, and its length is not a stall. The primary gets the configured
        deadline; a fallback member gets whatever budget is left. An ESCALATED
        primary (the smart tier, 1.1.142 M3) gets the budget less
        ``ESCALATION_FALLBACK_RESERVE_S`` — its p90 first token is ~20 s, and a
        10 s deadline would stall-kill most of the turns it exists for.
        """
        if not stream:
            return None
        if self.first_token_deadline_s is not None:
            if self.first_token_deadline_s <= 0:
                return None
            # An agent that set its own deadline also owns the budget it needs.
            return self.first_token_deadline_s if idx == 0 else max(remaining, self.first_token_deadline_s)
        configured = first_token_deadline()
        if configured is None:
            return None
        cap = max(remaining, 0.0)
        if idx == 0 and escalated:
            return min(max(configured, remaining - ESCALATION_FALLBACK_RESERVE_S), cap)
        return min(configured, cap) if idx == 0 else cap
