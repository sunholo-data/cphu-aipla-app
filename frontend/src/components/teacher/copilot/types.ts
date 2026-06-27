import type { ReactNode } from "react";

import type { ToolCallState } from "@/hooks/useSkillAgent";

/**
 * Describes how to render + edit ONE surface's proposal in the shared
 * `ProposalCard`. Each teacher surface owns its own `Proposal` union (class
 * management, activity authoring, …); this descriptor keeps the card generic
 * over it. The propose → Apply/Edit/Dismiss model is the shared "co-working
 * partnership" UX (the AI drafts, the human commits, nothing lands without an
 * Apply) — see docs/design/aipla/v1.1.0-feedback/teacher-coworking-copilot.md.
 */
export interface ProposalDescriptor<P> {
  /** Card header line, per proposal. */
  title: (proposal: P) => string;
  /** Inline free-text the teacher may edit before Apply, or null for kinds that
   *  aren't text-editable. When non-null, an Edit button appears. */
  editableText?: (proposal: P) => string | null;
  /** Re-build the proposal carrying the edited text. Required when
   *  `editableText` can return non-null. */
  withEditedText?: (proposal: P, text: string) => P;
  /** Custom read-only body for non-editable kinds (e.g. a checklist preview). */
  body?: (proposal: P) => ReactNode;
}

/** Visible button/label strings for the card — defaults are English; surfaces
 *  with a fixed locale (e.g. the Danish authoring co-pilot) override them. */
export interface CopilotLabels {
  apply: string;
  useEdited: string;
  edit: string;
  dismiss: string;
  applied: string;
  thinking: string;
}

export const DEFAULT_LABELS: CopilotLabels = {
  apply: "Apply",
  useEdited: "Use this",
  edit: "Edit",
  dismiss: "Dismiss",
  applied: "Applied ✓",
  thinking: "Thinking…",
};

/** Per-surface configuration for `<TeacherCopilot>`. The shell owns the panel,
 *  slug→UUID resolution, auth, chat transport, and cards; the surface supplies
 *  only what's specific to it. */
export interface TeacherCopilotConfig<P> {
  /** Platform skill slug, e.g. "manage-class". */
  skillName: string;
  /** Panel title + minimized-pill label. */
  title: string;
  /** Prefix prepended to the user's message so the agent scopes correctly,
   *  e.g. `[class_id=abc] ` — matches the analytics-chat contract. "" for none. */
  scopePrefix?: string;
  placeholder: string;
  emptyText: string;
  /** Parse one tool-call result into a typed proposal, or null if it isn't one.
   *  Omit for a READ-ONLY co-pilot (e.g. analytics) — no proposal cards. */
  parseProposal?: (toolCall: ToolCallState) => P | null;
  proposalDescriptor?: ProposalDescriptor<P>;
  /** Commit a proposal to the human's surface (REST write, builder mutation, …).
   *  This is where "the change lands next to the teacher's own edits". Omit for
   *  a read-only co-pilot. */
  onApplyProposal?: (proposal: P) => void | Promise<void>;
  /** When true, the proposal card is REMOVED on Apply instead of leaving a
   *  persistent "Applied ✓" badge. Right when the effect is visible elsewhere
   *  (the class appears in the list), so the chat doesn't accumulate badges.
   *  Default false (keep the badge — e.g. the authoring co-pilot, where the
   *  badge reminds the teacher they can still edit the applied field). */
  dismissOnApply?: boolean;
  /** Strip the scope prefix from rendered user bubbles (the prefix is for the
   *  agent's eyes, not the teacher's). */
  stripPrefix?: (content: string) => string;
  labels?: Partial<CopilotLabels>;
  /** localStorage key suffix for resuming this chat across visits (default:
   *  skillName). The threadId is persisted so returning re-loads the prior
   *  conversation (via the backend session); "New chat" resets it. Pass a
   *  scope-specific value (e.g. `manage-class:<classId>`) for per-scope threads. */
  persistKey?: string;
}
