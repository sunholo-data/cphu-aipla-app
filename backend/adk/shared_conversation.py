"""Tell the tutor when a group's conversation is shared by several screens
(1.1.145 — M0 results, the teacher seminar of 2026-10-05).

Every device that joins one group code runs under ONE synthetic uid and, per
activity, ONE ADK session (ADR-001; 1.1.53 "the group is one logical user on N
screens"). The tutor therefore reads every message any of those devices sends.
Nothing in its prompt said so. Asked on prod *"har du koblet svar fra andre i
gruppen ind i din samtale med mig?"*, it answered *"Nej, jeg kan kun se det, du
og din arbejdsflade bidrager med her"* — false: it was answering from all of
them.

This block is composed from the LIVE presence count of the turn's
(group, activity) — ephemeral per-tab tokens, never identities — and is empty
for one device, for teachers, and for anyone else not on a group code, so a
single-device conversation composes byte-identically to before.

The count is prompt-only. Recording it per turn on ``chat_turns`` (D3 / M4) is a
change to what research collects and is gated on JB's sign-off; nothing here
writes it anywhere.

English, like every other instruction block: the language the tutor ANSWERS in
comes from the language directive, not from the language its instructions are
written in.
"""

from __future__ import annotations


def build_shared_conversation_block(devices_present: int) -> str:
    """The "this conversation is shared" instruction, or "" when it is not.

    Args:
        devices_present: screens on this (group, activity) right now, from
            ``db.group_sessions.count_present_devices``. 0 or 1 → not shared.

    Returns:
        A prompt block to append to the agent's instruction, or "".
    """
    if devices_present <= 1:
        return ""
    return (
        "\n\n## This conversation is shared by a group\n"
        f"Right now {devices_present} screens are open on this conversation. The students in this "
        "group share one group code, so the messages here can come from different students on "
        "different devices, and you receive all of them as one conversation. Each student sees "
        "the others' messages and your replies in the chat, labelled as coming from another "
        "device in the group.\n"
        "- If a student asks whether you can see what the others in the group have written, "
        "answer truthfully: yes — everything anyone in the group sends in this conversation "
        "reaches you. Never claim you can only see one student's messages.\n"
        "- You cannot tell which student wrote which message. Do not guess at names or attribute "
        "a message to a particular person; speak to the group, or to 'whoever asked'.\n"
        "- When two messages arrive close together, answer them in turn rather than merging them "
        "into one student's train of thought."
    )


__all__ = ["build_shared_conversation_block"]
