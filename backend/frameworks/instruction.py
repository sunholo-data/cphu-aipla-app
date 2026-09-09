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

_PREFACE = (
    "Run this conversation as the teaching framework below describes. "
    "Work through its moves in order within a turn where the conversation allows it; "
    "the moves are what the framework is, not a checklist to announce to the student. "
    "Never name the framework or its terminology to the student."
)


def build_framework_instruction(framework: TeachingFramework | None) -> str:
    """Render ``framework`` as a system-prompt preamble.

    Returns ``""`` for ``None``, for a placeholder framework, and for one whose
    constructs carry no behaviours — in every case the caller appends nothing and
    the tutor composes exactly as it would have.
    """
    if framework is None or framework.is_placeholder:
        return ""

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
        block.extend(f"- {b}" for b in construct.behaviours)
        blocks.append("\n".join(block))

    if not blocks:
        return ""

    parts = [_HEADER.format(label=framework.label), _PREFACE]
    if summary:
        parts.append(summary)
    parts.extend(blocks)
    return "\n\n".join(parts).strip()


__all__ = ["build_framework_instruction"]
