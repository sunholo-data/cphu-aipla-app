"""Propose-tools for the tutor co-pilot (1.1.91 M2).

The fourth co-pilot mount, on the shipped shell (`components/teacher/copilot/`),
using the same propose → Apply / Edit / Dismiss contract as
``adk/authoring_tools.py``. Nothing here persists; the write rides the existing
researcher-gated ``PUT /api/research/frameworks/{id}/structure`` when a human
clicks Apply.

## The hard requirement: the co-pilot must not invent citations

1.1.91 states this as a requirement rather than a caution, and the reason is
specific: a model confabulating a reference into a research instrument that ends
up in a journal paper is the worst failure available here.

It is enforced structurally, in three layers, because a prompt instruction is
not an enforcement mechanism:

1. **The type system.** ``Provenance.vouched_by`` has no default and
   ``min_length=1``, so an unvouched citation is unconstructable — it cannot be
   validated into a framework at all.
2. **The tool boundary.** ``_strip_provenance`` removes every citation a model
   puts in a proposal and replaces it with an explicit stub saying a human must
   supply it. A proposal therefore CANNOT carry a citation the model wrote, no
   matter what the model tries.
3. **One grounded path in.** ``find_source_passages`` is the only way a real
   citation reaches a proposal, and it does not generate one: it retrieves
   passages from the literature corpus and pairs them with the citation already
   vouched in that framework's YAML ``provenance``. The model chooses which
   passage is relevant; it never chooses what the source IS.

So the worst a confabulating model can do is propose a *shape* with an empty
provenance list and a note telling a researcher to fill it — which is exactly
what M1's design asks for.

## Researcher-only, resolved server-side

These tools read copyrighted literature and propose changes to research
instruments. ``_caller_is_researcher`` resolves the ``role:researcher`` custom
claim from the caller's uid through the Firebase Admin SDK — not from anything
the client says, and not from prompt context.

⚠️ An UNREADABLE claim is refused, loudly, and is reported differently from a
genuine "not a researcher". They are different facts and the reassuring one must
not stand in for the other (CLAUDE.md's deploy-status footgun, applied to a gate).
"""

from __future__ import annotations

import logging
from typing import Any

from google.adk.tools import ToolContext

from analytics.auth import caller_uid_or_none as _caller_uid

logger = logging.getLogger(__name__)

#: Returned when the caller is not a researcher. Byte-identical for "not a
#: researcher" and "no identity" — neither should let a caller probe the other.
_DENY: dict[str, Any] = {
    "ok": False,
    "error": "this co-pilot is for researchers; ask a platform admin for the role",
}

#: Returned when the claim could NOT BE READ. Deliberately distinct from _DENY:
#: failing closed is right, but reporting an outage as a permissions answer is
#: how "the reassuring answer is the one a broken read produces" happens.
_UNREADABLE: dict[str, Any] = {
    "ok": False,
    "error": "could not verify your researcher role just now — this is a failed check, not a refusal",
}

MAX_LABEL = 120
MAX_SUMMARY = 800
MAX_BEHAVIOURS = 24


def _caller_is_researcher(tool_context: ToolContext | None) -> bool | None:
    """True / False / None, where None means the claim could not be read.

    Three-valued on purpose. A gate that cannot tell "no" from "don't know"
    turns an outage into an authorization answer.
    """
    uid = _caller_uid(tool_context)
    if not uid:
        return False
    try:
        from firebase_admin import auth as fb_auth

        claims = fb_auth.get_user(uid).custom_claims or {}
    except Exception as exc:
        logger.warning("tutor co-pilot: could not read claims for uid=%s: %s", uid, type(exc).__name__)
        return None
    return claims.get("role") == "researcher"


def _guard(tool_context: ToolContext | None) -> dict[str, Any] | None:
    """None when the caller may proceed, else the response to return."""
    verdict = _caller_is_researcher(tool_context)
    if verdict is None:
        return dict(_UNREADABLE)
    return None if verdict else dict(_DENY)


def _strip_provenance(constructs: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Remove any citation a model attached to a proposed construct.

    Layer 2 of the never-invent-a-citation rule. The model is not asked to
    behave; its output is structurally incapable of carrying a citation, because
    this runs over everything before it becomes a proposal.
    """
    cleaned: list[dict[str, Any]] = []
    for c in constructs or []:
        if not isinstance(c, dict):
            continue
        keep = {k: v for k, v in c.items() if k not in ("provenance", "citation", "citations", "source", "sources")}
        cleaned.append(keep)
    return cleaned


def _behaviour_list(behaviours: list[str] | None) -> list[dict[str, str]]:
    out = []
    for b in behaviours or []:
        text = (b or "").strip() if isinstance(b, str) else ""
        if text:
            out.append({"text": text})
    return out[:MAX_BEHAVIOURS]


def propose_approach(
    label: str,
    summary: str = "",
    construct_names: list[str] | None = None,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Propose the SHAPE of a teaching approach — its name and its constructs.

    Use when a researcher describes a pedagogy they want a tutor to run on
    ("a tutor grounded in self-determination theory"). Proposes the constructs
    the approach is made of; it does NOT write behaviours (use
    ``propose_behaviours`` per construct) and it does NOT supply citations.

    ⚠️ This tool cannot attach a citation. Any source you name is discarded
    before the proposal is built. A researcher supplies provenance, or it comes
    from ``find_source_passages`` against the literature actually held.

    Args:
        label: The approach's human name.
        summary: One or two sentences on what it asks a tutor to do.
        construct_names: The named moves the approach is made of, in order.

    Returns:
        A proposal the researcher Applies, with an empty provenance list and a
        note saying who must fill it.
    """
    denied = _guard(tool_context)
    if denied:
        return denied

    name = (label or "").strip()
    if not name:
        return {"ok": False, "error": "the approach needs a name"}
    if len(name) > MAX_LABEL:
        return {"ok": False, "error": f"the name is too long (max {MAX_LABEL} characters)"}

    constructs = [
        {"name": n.strip(), "behaviours": [], "avoid": []}
        for n in (construct_names or [])
        if isinstance(n, str) and n.strip()
    ]
    if not constructs:
        return {"ok": False, "error": "an approach needs at least one construct"}

    logger.info("tutor co-pilot: propose_approach %r with %d construct(s)", name, len(constructs))
    return {
        "ok": True,
        "proposal": {
            "kind": "propose_approach",
            "label": name,
            "summary": (summary or "").strip()[:MAX_SUMMARY],
            "constructs": _strip_provenance(constructs),
            # ALWAYS empty. See the module docstring, layer 2.
            "provenance": [],
            "needsVouching": (
                "No citation is attached. Add the source yourself, or use the source search — "
                "a proposal cannot carry a reference this co-pilot wrote."
            ),
        },
    }


def propose_behaviours(
    construct_name: str,
    behaviours: list[str] | None = None,
    avoid: list[str] | None = None,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Propose observable, promptable behaviours for one construct.

    The step researchers find tedious and models are good at. Behaviours must be
    things a tutor DOES in a turn — "offer a choice of route", not "support
    autonomy" — because a generated prompt is built from them verbatim and a
    reviewer checks the prompt against them.

    ``avoid`` is the counter-indicative list: the moves that mark the
    degeneration this construct is defined against. Naming them is worth more to
    a tutor prompt than another positive example, because they are what an LLM
    reaches for by default.

    Args:
        construct_name: Which construct these belong to.
        behaviours: Observable moves, one per line.
        avoid: Counter-indicative moves.
    """
    denied = _guard(tool_context)
    if denied:
        return denied

    name = (construct_name or "").strip()
    if not name:
        return {"ok": False, "error": "which construct are these for?"}
    moves = _behaviour_list(behaviours)
    if not moves:
        return {"ok": False, "error": "no behaviours proposed"}

    logger.info("tutor co-pilot: propose_behaviours for %r (%d)", name, len(moves))
    return {
        "ok": True,
        "proposal": {
            "kind": "propose_behaviours",
            "constructName": name,
            "behaviours": moves,
            "avoid": [a.strip() for a in (avoid or []) if isinstance(a, str) and a.strip()][:12],
        },
    }


def draft_approach_prompt(framework_id: str, tool_context: ToolContext = None) -> dict[str, Any]:
    """Show what a tutor is actually told by an existing approach.

    ⚠️ Renders through the SAME generator that runs in a lesson
    (``build_framework_instruction``), never by asking a model to imagine it. An
    approximation here would drift from what the tutor is really told, which is
    the precise failure this whole layer exists to prevent.
    """
    denied = _guard(tool_context)
    if denied:
        return denied

    from db.framework_overrides import effective_framework
    from frameworks.instruction import build_framework_instruction

    fw = effective_framework(framework_id)
    if fw is None:
        return {"ok": False, "error": f"no approach called {framework_id!r}"}
    return {
        "ok": True,
        "frameworkId": fw.id,
        "label": fw.label,
        "instruction": build_framework_instruction(fw),
        "register": fw.teaching_register,
        "note": "Generated by the same code that runs in the lesson — not an approximation.",
    }


def critique_approach(framework_id: str, tool_context: ToolContext = None) -> dict[str, Any]:
    """Check an approach against its own claims — the inverse, and the useful one.

    *"Your approach claims to support autonomy but never offers a choice."*

    Returns COMPUTED observations about the approach's structure — construct and
    behaviour counts, constructs with no behaviours, missing avoid-lists,
    unvouched sources, and whether its register contradicts its own moves. The
    model's job is to read these and say what they mean, not to invent them.
    """
    denied = _guard(tool_context)
    if denied:
        return denied

    from db.framework_overrides import effective_framework

    fw = effective_framework(framework_id)
    if fw is None:
        return {"ok": False, "error": f"no approach called {framework_id!r}"}

    empty = [c.name for c in fw.constructs if not c.behaviours]
    no_avoid = [c.name for c in fw.constructs if not c.avoid]
    no_hint = [c.name for c in fw.constructs if not c.evaluation_hint]
    ask_moves = sum(
        1
        for c in fw.constructs
        for b in c.behaviours
        if any(w in b.text.lower() for w in ("ask", "question", "predict", "elicit", "why"))
    )
    total = sum(len(c.behaviours) for c in fw.constructs)

    # The register/moves contradiction 1.1.111 exists to prevent — reported here
    # so a researcher sees it while editing rather than in a transcript.
    register_conflict = None
    if fw.teaching_register == "concise" and ask_moves:
        register_conflict = (
            f"The voice is 'concise', which tells the tutor not to end with a follow-up question, "
            f"while {ask_moves} of {total} moves ask or elicit."
        )
    elif fw.teaching_register == "warm" and ask_moves:
        register_conflict = (
            f"The voice is 'warm', which hints before asking, while {ask_moves} of {total} moves elicit first."
        )

    return {
        "ok": True,
        "frameworkId": fw.id,
        "observations": {
            "constructs": len(fw.constructs),
            "behaviours": total,
            "askOrElicitMoves": ask_moves,
            "constructsWithNoBehaviours": empty,
            "constructsWithNoAvoidList": no_avoid,
            "constructsWithNoEvaluationHint": no_hint,
            "sources": len(fw.provenance),
            "unvouchedSources": [p.citation[:80] for p in fw.provenance if not p.vouched_by],
            "registerConflict": register_conflict,
            "status": fw.status,
        },
        "note": "These are measured from the approach as stored. Say what they mean; do not add findings.",
    }


async def find_source_passages(
    framework_id: str,
    query: str,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Find passages in the papers an approach is drafted from.

    **The only path by which a real citation reaches a proposal.** It does not
    generate a reference: it retrieves text from the literature corpus and pairs
    it with the citation already vouched for in that approach's YAML
    ``provenance``. The model picks which passage is relevant; it never decides
    what the source is.

    ⚠️ Verbatim extracts from copyrighted journal articles. Researcher-only, and
    the corpus is unreachable from any student session by construction
    (``scripts/check-literature-corpus-isolation.sh``).

    Reports ``configured: false`` when the corpus is not provisioned, rather
    than returning an empty list — "no passages" and "no corpus" are different
    facts and the first reads as the paper not supporting the claim.
    """
    denied = _guard(tool_context)
    if denied:
        return denied

    from db.framework_overrides import effective_framework
    from db.literature_corpus import get_literature_corpus_name, query_literature

    fw = effective_framework(framework_id)
    if fw is None:
        return {"ok": False, "error": f"no approach called {framework_id!r}"}
    if fw.is_custom:
        return {
            "ok": False,
            "error": "a custom approach has no source literature — it is authored, not drafted from a paper",
        }
    if not get_literature_corpus_name():
        return {"ok": True, "configured": False, "passages": [], "citations": []}

    passages = await query_literature(query, top_k=5, framework_id=framework_id)
    return {
        "ok": True,
        "configured": True,
        "passages": passages,
        # Resolved from the approach's OWN provenance, never from the corpus and
        # never from the model.
        "citations": [{"citation": p.citation, "vouchedBy": p.vouched_by} for p in fw.provenance],
        "note": "Cite only from `citations`. Never write a reference that is not in that list.",
    }


__all__ = [
    "critique_approach",
    "draft_approach_prompt",
    "find_source_passages",
    "propose_approach",
    "propose_behaviours",
]
