"""The tutor sends the student to the workbench — inventory, rule, nudge (1.1.149 M2).

**The complaint, twice.** Aswin, 2026-08-06: *"The chat never asked me to work on
those tools."* 1.1.62 answered with an element manifest. M, teacher seminar
2026-10-05: *"The tutor never asked the student to use the simulations."* The
prod read that evening (design doc, *M0 results*) showed why the manifest did
not produce the behaviour:

* the tutor COULD see the sim — its ``tutorBlock`` was in ``{teacher_focus}`` and
  its live state arrived through ``mcp_app_context`` — and it read that state
  back to students who had used it; but
* the manifest iterates ``ELEMENT_REGISTRY``, and a sim is not a registry
  element, so **the sim was never listed as a thing on the bench**; and
* ``concept-dialogue/SKILL.md`` said *"There is no simulator on screen"*, in the
  same body ``{teacher_focus}`` is substituted into; and
* the manifest's one instruction (*"when the conversation reaches them"*) has no
  trigger a model can recognise and sits early, where the framework preamble
  and a dozen house-style blocks come after it.

Tables, which the manifest DID name, were referred to in ~33% of tutor turns:
inventory drives referral, and naming alone is not enough.

**What this block is.** A per-turn ``InstructionProvider`` placed after the
element fill-state block, so it is the last workbench text the model reads and
comes after the teaching-framework preamble (*later instruction wins*):

1. **Inventory**, sim first: the sim's ``displayName`` and catalogue
   ``description`` (never its ``tutorBlock`` again — that is already in the
   prompt) and whether ``control_sim`` is available; then each element by kind
   and title (named with ``element_manifest.name_element``, so an untitled one
   is never called "untitled"). *untouched* / *in use* is read from the SAME
   observation the fill-state block reported this turn, not recomputed.
2. **The referral rule**, with triggers a model can recognise, tuned by the
   framework's optional ``workbench_use`` (null → ``balanced``).
3. **The nudge**, deterministic: after exactly ``K`` consecutive tutor turns that
   did not refer to the bench (per ``analytics.workbench_referral``, the matcher
   the bench and the prod SQL share) **and** with an item still untouched, one
   sentence names that item. Again after ``2K``, ``3K``… — never on the opening
   turn, never twice inside ``K`` turns.

**Ownership** (design doc): the activity says WHAT is on the bench, the sim
catalogue what the sim IS, the platform THAT the tutor refers to it, the
framework HOW EARLY. No layer below this one owns "point the student at the sim",
which is why nobody did.

**Passthrough.** An activity with no sim and no element gets ``""`` — its
instruction is byte-identical with or without this wrapper. A framework whose
``workbench_use`` is null contributes nothing; the platform default applies
identically with or without a tutor (handover rule 1).
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

from adk.element_manifest import name_element
from adk.proactive_greet import GREET_SENTINEL, _user_text
from adk.prompt_budget import clip
from analytics.workbench_referral import (
    CONTROL_SIM_TOOL,
    Vocabulary,
    is_referral,
    referral_vocabulary,
)
from db.models.activity_config import ELEMENT_REGISTRY, ActivityConfig

log = logging.getLogger(__name__)

WorkbenchUse = Literal["dialogue_first", "balanced", "workbench_first"]

#: The platform default when an approach says nothing (O2: set on no framework).
DEFAULT_WORKBENCH_USE: WorkbenchUse = "balanced"

#: Tutor turns without a referral before the nudge fires (design doc O5: a first
#: guess, to be confirmed against M6).
NUDGE_EVERY_K = 3

#: The whole block, rule included. Inventory lines are dropped item-wise first;
#: the rule and the nudge are always kept. The design doc proposed 1,200; with
#: the rule (~650) and a nudge (~250) that left one sim line and nothing else, so
#: a sim + checklist + untitled table — the seminar's own shape — lost two of its
#: three items on exactly the turn the nudge fired. 1,600 fits that bench whole.
AFFORDANCES_CHAR_CAP = 1600

_SIM_DESCRIPTION_CLIP = 160

_HEADER = "WORKBENCH — what the student has beside this chat right now (refreshed every turn):"

_RULE_INTRO = (
    "Sending the student to the workbench is part of your job. A referral is an action, not a mention: "
    "name the item as the student sees it, ask them to do one specific thing there, and to tell you what "
    "they found. Refer to a named item"
)

_TRIGGERS: dict[str, list[str]] = {
    "balanced": [
        "(a) in your opening turn — point at where to start;",
    ],
    "dialogue_first": [
        "(a) once, early, so the student knows it is there — then let the conversation lead;",
    ],
    "workbench_first": [
        "(a) in your opening turn — point at where to start;",
        "(e) before discussing an idea at length — send them to try it on the workbench first, then talk;",
    ],
}

_COMMON_TRIGGERS = [
    "(b) when the student is stuck, guesses, or asks for the answer — send them to the item that would let "
    "them find out, instead of telling them;",
    "(c) when a claim needs evidence the workbench can produce;",
    "(d) after they used the simulation or entered something — tie your reply to what they just did.",
]

_RULE_OUTRO = "One referral per reply is enough, and it fits inside your other rules."

_NOUNS: dict[str, str] = {
    "checklist": "Checklist",
    "table": "Data table",
    "chart": "Chart",
    "calculator": "Calculator",
    "note": "Note",
    "writing": "Writing surface",
    "solution": "Solution editor",
    "document": "Document upload",
    "conceptMap": "Concept map",
}

#: Kinds whose items carry a ``title`` the student reads above them.
_TITLED = frozenset({"table", "chart", "calculator", "note", "writing", "conceptMap"})


@dataclass(frozen=True)
class BenchItem:
    """One thing on the workbench, as the tutor is told about it."""

    kind: str  # "sim" or an ELEMENT_REGISTRY kind
    element_id: str
    name: str
    line: str
    # True / False when observed this turn; None when the kind has no fill channel.
    untouched: bool | None = None


# --- policy -----------------------------------------------------------------------


def resolve_workbench_use(framework_id: str | None) -> WorkbenchUse:
    """The approach's ``workbench_use``, else the platform default. Never raises —
    this sits on the agent build path (Axiom 5), like ``resolve_sim_control_level``."""
    if not framework_id:
        return DEFAULT_WORKBENCH_USE
    try:
        from db.framework_overrides import effective_framework

        fw = effective_framework(framework_id)
    except Exception as exc:  # pragma: no cover — defensive, see docstring
        log.warning("workbench_use: framework %s unreadable (%s) — using %s", framework_id, exc, DEFAULT_WORKBENCH_USE)
        return DEFAULT_WORKBENCH_USE
    value = getattr(fw, "workbench_use", None) if fw is not None else None
    return value if value in _TRIGGERS else DEFAULT_WORKBENCH_USE


def render_rule(policy: str) -> str:
    triggers = [*_TRIGGERS.get(policy, _TRIGGERS[DEFAULT_WORKBENCH_USE]), *_COMMON_TRIGGERS]
    # (e) is an addition, so it reads after (d) whatever order it was declared in.
    triggers.sort(key=lambda t: t[:3])
    return "\n".join([_RULE_INTRO + ":", *(f"  {t}" for t in triggers), _RULE_OUTRO])


# --- inventory --------------------------------------------------------------------


def _sim_item(cfg: ActivityConfig, state: dict[str, Any], *, control_sim: bool, meta: Any) -> BenchItem | None:
    artefact_id = getattr(cfg, "artefact_id", None)
    if not artefact_id:
        return None
    display = (getattr(meta, "display_name", "") or "").strip() if meta is not None else ""
    name = f'the simulation "{display}"' if display else "the simulation"
    prefix = f"mcp_app_context.{artefact_id}."
    untouched = not any(str(k).startswith(prefix) for k in state)
    line = f'- Simulation "{display}"' if display else "- Simulation"
    description = (getattr(meta, "description", "") or "").strip() if meta is not None else ""
    if description:
        line += f" — {clip(description, _SIM_DESCRIPTION_CLIP)}"
    line += " [untouched]" if untouched else " [in use]"
    if control_sim:
        line += f" You can also change what it shows with `{CONTROL_SIM_TOOL}`."
    return BenchItem("sim", artefact_id, name, line, untouched)


def _element_items(cfg: ActivityConfig, fills: list[Any]) -> list[BenchItem]:
    observed = {(f.kind, f.element_id): f for f in fills}
    items: list[BenchItem] = []
    for kind, spec in ELEMENT_REGISTRY.items():
        authored = getattr(cfg, spec.field, None) or []
        if not authored:
            continue
        noun = _NOUNS.get(kind, kind)
        if kind == "checklist":
            name = "the checklist"
            items.append(
                BenchItem(
                    kind, "", name, f"- Checklist — {len(authored)} step{'s' if len(authored) != 1 else ''}", None
                )
            )
            continue
        for n, el in enumerate(authored, 1):
            element_id = str(getattr(el, "id", "") or "")
            if kind in _TITLED:
                label = name_element(noun, getattr(el, "title", ""), n)
            else:
                label = noun if len(authored) == 1 else f"{noun} no. {n}"
            fill = observed.get((kind, element_id))
            untouched: bool | None = None
            line = f"- {label}"
            if fill is not None and fill.total > 0:
                untouched = fill.filled <= 0
                line += " [untouched]" if untouched else " [in use]"
            items.append(BenchItem(kind, element_id, f"the {label[0].lower()}{label[1:]}", line, untouched))
    return items


def bench_items(
    cfg: ActivityConfig | None,
    state: dict[str, Any] | None,
    fills: list[Any],
    *,
    control_sim: bool = False,
    sim_meta: Any = None,
) -> list[BenchItem]:
    """Everything on the bench, sim first. Empty for an activity with neither."""
    if cfg is None:
        return []
    out: list[BenchItem] = []
    sim = _sim_item(cfg, state or {}, control_sim=control_sim, meta=sim_meta)
    if sim is not None:
        out.append(sim)
    out.extend(_element_items(cfg, fills))
    return out


# --- the nudge --------------------------------------------------------------------


def _event_text_and_calls(event: Any) -> tuple[str, list[str]]:
    content = getattr(event, "content", None)
    parts = getattr(content, "parts", None) or []
    text = " ".join((getattr(p, "text", "") or "") for p in parts).strip()
    calls = [getattr(getattr(p, "function_call", None), "name", "") for p in parts]
    return text, [c for c in calls if c]


def _is_student_message(event: Any) -> bool:
    """A user-authored event with text. Function responses ride on agent-authored
    events in ADK, so they never split a tutor turn."""
    if getattr(event, "author", "user") != "user":
        return False
    text, _ = _event_text_and_calls(event)
    return bool(text)


def tutor_turns(events: list[Any] | None) -> list[tuple[str, list[str]]]:
    """The session's tutor turns as ``(text, tool names called)``, oldest first.

    A tutor turn is the run of agent-authored events between two student
    messages — text, a tool call and the reply after it are ONE turn.
    """
    turns: list[tuple[str, list[str]]] = []
    current: tuple[list[str], list[str]] | None = None
    for event in events or []:
        if _is_student_message(event):
            if current is not None:
                turns.append((" ".join(current[0]).strip(), current[1]))
                current = None
            continue
        if getattr(event, "author", "user") == "user":
            continue
        text, calls = _event_text_and_calls(event)
        if not text and not calls:
            continue
        if current is None:
            current = ([], [])
        if text:
            current[0].append(text)
        current[1].extend(calls)
    if current is not None:
        turns.append((" ".join(current[0]).strip(), current[1]))
    return turns


def non_referring_streak(events: list[Any] | None, vocabulary: Vocabulary | None) -> int:
    """How many of the most recent tutor turns, in a row, did not refer to the bench."""
    streak = 0
    for text, calls in reversed(tutor_turns(events)):
        if is_referral(text, vocabulary, function_calls=calls):
            break
        streak += 1
    return streak


def should_nudge(streak: int, *, opening_turn: bool, k: int = NUDGE_EVERY_K) -> bool:
    """Exactly at ``k``, ``2k``, … non-referring turns — so at most once per ``k``."""
    return not opening_turn and k > 0 and streak >= k and streak % k == 0


def render_nudge(item: BenchItem, k: int = NUDGE_EVERY_K) -> str:
    return (
        f"Reminder: your last {k} replies did not send the student to the workbench, and {item.name} is still "
        "untouched. In this reply, ask them to do one specific thing with it and tell you what they found."
    )


# --- composition ------------------------------------------------------------------


def compose_workbench_affordances(
    items: list[BenchItem],
    *,
    policy: str = DEFAULT_WORKBENCH_USE,
    nudge: str = "",
) -> str:
    """The block, or ``""`` when nothing is on the bench."""
    if not items:
        return ""
    rule = render_rule(policy)
    fixed = len(_HEADER) + len(rule) + (len(nudge) + 2 if nudge else 0) + 4
    budget = AFFORDANCES_CHAR_CAP - fixed
    lines: list[str] = []
    used = 0
    for i, item in enumerate(items):
        cost = len(item.line) + 1
        if used + cost > budget - 12:  # room for the "(+N more)" marker
            lines.append(f"(+{len(items) - i} more)")
            break
        lines.append(item.line)
        used += cost
    parts = [_HEADER, *lines, "", rule]
    if nudge:
        parts.extend(["", nudge])
    return "\n".join(parts)


class TurnFills:
    """This turn's element observation, handed from the fill-state wrapper to the
    affordances wrapper (they run in the same provider chain, one after the other).

    Keyed by the context object so a stale observation from another turn is never
    read; on a miss the affordances wrapper reads the fills itself.
    """

    def __init__(self) -> None:
        self._key: int | None = None
        self._fills: list[Any] = []

    def observe(self, ctx: Any, fills: list[Any]) -> None:
        self._key = id(ctx)
        self._fills = list(fills)

    def take(self, ctx: Any) -> list[Any] | None:
        if self._key != id(ctx):
            return None
        fills, self._key, self._fills = self._fills, None, []
        return fills


def make_workbench_affordances_wrapper(
    cfg: ActivityConfig | None,
    *,
    policy: str = DEFAULT_WORKBENCH_USE,
    control_sim: bool = False,
    turn_fills: TurnFills | None = None,
    group_id: str | None = None,
    activity_id: str | None = None,
) -> Callable[[Any], Callable[[Any], Awaitable[str]]]:
    """An ``InstructionProvider`` wrapper for ``compose_instruction_providers``.

    Place it AFTER ``make_element_state_wrapper`` (pass that wrapper the same
    ``turn_fills.observe``). Everything fixed for the session — the sim's
    catalogue entry, the vocabulary — is resolved once here; the fill state and
    the nudge are per turn.
    """
    sim_meta = None
    artefact_id = getattr(cfg, "artefact_id", None) if cfg is not None else None
    if artefact_id:
        try:
            from artefacts.loader import load_artefact

            sim_meta = load_artefact(artefact_id)
        except Exception:  # pragma: no cover — a catalogue read must never break a session
            log.exception("workbench_affordances: artefact %s unreadable — naming it generically", artefact_id)
    vocabulary = referral_vocabulary(cfg)

    def _wrapper(base: Any) -> Callable[[Any], Awaitable[str]]:
        async def _provider(ctx: Any) -> str:
            base_text = await base(ctx) if callable(base) else base
            if cfg is None:
                return base_text
            state = dict(ctx.state) if getattr(ctx, "state", None) else {}
            fills = turn_fills.take(ctx) if turn_fills is not None else None
            if fills is None:
                from adk.element_state import read_element_fills, read_table_cells

                fills = read_element_fills(cfg, state, table_cells=read_table_cells(group_id, activity_id))
            items = bench_items(cfg, state, fills, control_sim=control_sim, sim_meta=sim_meta)
            if not items:
                return base_text

            text = _user_text(ctx)
            # The greet turn: there is no history to count, and trigger (a) in the
            # rule already covers it.
            opening = text == GREET_SENTINEL
            session = getattr(ctx, "session", None)
            streak = non_referring_streak(getattr(session, "events", None), vocabulary)
            untouched = [i for i in items if i.untouched]
            nudge = ""
            if untouched and should_nudge(streak, opening_turn=opening):
                nudge = render_nudge(untouched[0])

            log.info(
                "workbench_affordances: activity=%s items=%d policy=%s streak=%d nudged=%s",
                getattr(cfg, "activity_id", None) or "-",
                len(items),
                policy,
                streak,
                untouched[0].name if nudge else "no",
            )
            block = compose_workbench_affordances(items, policy=policy, nudge=nudge)
            return f"{base_text.rstrip()}\n\n{block}"

        return _provider

    return _wrapper


__all__ = [
    "AFFORDANCES_CHAR_CAP",
    "DEFAULT_WORKBENCH_USE",
    "NUDGE_EVERY_K",
    "BenchItem",
    "TurnFills",
    "bench_items",
    "compose_workbench_affordances",
    "make_workbench_affordances_wrapper",
    "non_referring_streak",
    "render_nudge",
    "render_rule",
    "resolve_workbench_use",
    "should_nudge",
    "tutor_turns",
]
