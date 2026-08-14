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
  /** aria-label for the inline Edit textarea (a11y, locale-specific). */
  editAriaLabel: string;
}

export const DEFAULT_LABELS: CopilotLabels = {
  apply: "Apply",
  useEdited: "Use this",
  edit: "Edit",
  dismiss: "Dismiss",
  applied: "Applied ✓",
  thinking: "Thinking…",
  editAriaLabel: "Edit proposal",
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
  /** Root data-testid for the chat region (default "teacher-copilot"). Surfaces
   *  with their own test suites (e.g. authoring → "authoring-copilot") override it. */
  testId?: string;
  /** aria-label for the message input, when it must differ from `placeholder`
   *  (the Danish authoring co-pilot labels the field differently from its hint).
   *  Defaults to `placeholder`. */
  inputAriaLabel?: string;
  /** Text shown while the skill slug resolves (default: the `thinking` label).
   *  Locale-specific surfaces override it (authoring → "Indlæser medbygger…"). */
  loadingText?: string;
  /** aria-label for the panel's minimize control (default "Minimize"). */
  minimizeLabel?: string;
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
  /** On-demand panels (opened from a header button) pass this: the panel shows
   *  a Close (X) that unmounts it instead of the minimize-to-pill. */
  onClose?: () => void;
  /** Corner the panel sits in — "left" keeps a help co-pilot clear of the
   *  work co-pilots (bottom-right). Default "right". */
  align?: "left" | "right";
  /** Persistent small link shown above the input (e.g. "Report a bug",
   *  mailto:…) — visible from the moment the panel opens, not just inside a
   *  reply, so it doesn't depend on the conversation having started. Omit for
   *  surfaces with nothing to link (the default). */
  helpLink?: { href: string; label: string };
}
