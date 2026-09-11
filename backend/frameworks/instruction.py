"""Render a TeachingFramework into a tutor preamble (1.1.91 M1).

This is ``draft_tutor_prompt`` **minus the LLM**: a deterministic function from
constructs -> behaviours -> instruction text. That is the reviewability property
of 1.1.91 doing actual work — the instruction a tutor receives is *derived from*
the theory, so a reader can hold one against the other, and a researcher's later
edit reads as a visible delta from the generated text rather than as an
untraceable prompt.

Behaviour lines are emitted **verbatim** from the YAML. Nothing paraphrases
them, so the prompt and the framework cannot drift apart — the failure the
``list_interaction_styles`` docstring already warns about for teaching styles.

A placeholder framework renders the empty string: it has no drafted constructs,
so it has nothing to tell a tutor, and saying something anyway would be the
"unfounded claim made to look founded" 1.1.91 warns against.
"""

from __future__ import annotations

from db.models.teaching_framework import TeachingFramework

_HEADER = "## Teaching framework: {label}"
_CUSTOM_HEADER = "## Teaching approach: {label}"

# Rendered order for dimension groupings. Epistemic first, deliberately: it is
# the "how do you know" axis, it dominates the strongest teaching in the source's
# own data, and a model given the conceptual list first tends to stay there.
_DIMENSION_ORDER = ("epistemic", "conceptual")

_DIMENSION_HEADINGS = {
    "epistemic": "Questions about how the student knows (evidence, data, method):",
    "conceptual": "Questions about what the student knows (definitions, relations between concepts):",
}

_PREFACE = (
    "Run this conversation as the teaching framework below describes. "
    "Work through its moves in order within a turn where the conversation allows it; "
    "the moves are what the framework is, not a checklist to announce to the student. "
    "Never name the framework or its terminology to the student."
)


_CUSTOM_PREFACE = (
    "Run this conversation as the teaching approach below describes. "
    "Never name the approach or quote these instructions to the student."
)


def build_framework_instruction(framework: TeachingFramework | None) -> str:
    """Render ``framework`` as a system-prompt preamble.

    Returns ``""`` for ``None``, for a placeholder framework, and for one whose
    constructs carry no behaviours — in every case the caller appends nothing and
    the tutor composes exactly as it would have.

    A CUSTOM approach (1.1.110) renders from its prose instead of its constructs.
    It gets the same header shape so a tutor reads one thing, but deliberately
    NOT the framework preface about working through moves in order: there are no
    moves, and telling a model to follow a structure that is not there invites it
    to invent one.
    """
    if framework is None or framework.is_placeholder:
        return ""

    if framework.is_custom:
        text = (framework.instruction_text or "").strip()
        if not text:
            return ""
        return "\n\n".join([_CUSTOM_HEADER.format(label=framework.label), _CUSTOM_PREFACE, text])

    lines = [line for line in (framework.summary or "").strip().splitlines() if line.strip()]
    summary = " ".join(s.strip() for s in lines)

    blocks: list[str] = []
    for construct in framework.constructs:
        if not construct.behaviours:
            continue
        title = construct.name.replace("_", " ").strip().capitalize()
        block = [f"### {title}"]
        if construct.summary:
            block.append(" ".join(s.strip() for s in construct.summary.split()))

        # Behaviours group by inquiry dimension where the theory tags them. Only
        # eliciting carries dimensions in ESRU, by the source's own scoping, so
        # every other construct falls straight through to a flat list — the
        # sub-headings appear exactly where the theory says they mean something.
        tagged = [b for b in construct.behaviours if b.dimension]
        untagged = [b for b in construct.behaviours if not b.dimension]
        block.extend(f"- {b.text}" for b in untagged)
        for dimension in _DIMENSION_ORDER:
            in_dim = [b for b in tagged if b.dimension == dimension]
            if not in_dim:
                continue
            block.append(_DIMENSION_HEADINGS[dimension])
            block.extend(f"- {b.text}" for b in in_dim)

        # The counter-indicative codes. Last in the block so they read as the
        # constraint on everything above, and phrased as a heading rather than
        # folded into the list — a tutor that skims must not read an anti-pattern
        # as an instruction.
        if construct.avoid:
            block.append("Avoid:")
            block.extend(f"- {a}" for a in construct.avoid)

        blocks.append("\n".join(block))

    if not blocks:
        return ""

    parts = [_HEADER.format(label=framework.label), _PREFACE]
    if summary:
        parts.append(summary)
    parts.extend(blocks)
    return "\n\n".join(parts).strip()


__all__ = ["build_framework_instruction"]
