/**
 * Shared teacher-facing copy for a tutor's TONE (1.1.20 / 1.1.12).
 *
 * `interactionStyle` is the field; **tone** is the word a teacher reads
 * (1.1.111, when it stopped being an axis of its own and became part of the
 * tutor). Single source of truth so every surface describes each tone
 * identically, and the help text mirrors the behaviour each tone's preamble
 * actually injects (`backend/skills/preambles/interaction_style/*.md`), so a
 * teacher's expectation matches what the tutor does.
 */

import type { InteractionStyle } from "@/lib/teacherApi";

/** Short chip label per style. */
export const INTERACTION_STYLE_LABEL: Record<InteractionStyle, string> = {
  socratic: "Socratic",
  concise: "Concise",
  rigorous: "Rigorous",
  warm: "Warm",
};

/** One-line description of how the tutor behaves in this style. */
export const INTERACTION_STYLE_HELP: Record<InteractionStyle, string> = {
  socratic: "Guides with questions, leaves room to notice. Ends each turn with a question.",
  concise: "Terse and directive — “just try this”. No follow-up questions.",
  rigorous: "Exam-level expectations; does not soften or over-scaffold.",
  warm: "Encouraging, more scaffolding — for lower-confidence students.",
};

/** Dropdown options in display order (Socratic is the platform default). */
export const INTERACTION_STYLE_OPTIONS: { value: InteractionStyle; label: string }[] = [
  { value: "socratic", label: "Socratic (default)" },
  { value: "concise", label: "Concise" },
  { value: "rigorous", label: "Rigorous" },
  { value: "warm", label: "Warm" },
];
