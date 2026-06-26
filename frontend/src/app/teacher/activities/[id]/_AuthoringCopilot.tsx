/**
 * `AuthoringCopilot` — the teacher-facing AG-UI chat island for the activity
 * builder (COPILOT-1 + COPILOT-2; designs 1.1.39 + 1.1.50).
 *
 * The teacher describes what they want to teach; the co-pilot's owner-scoped,
 * propose-only tools surface **proposals** here as Apply / Edit / Dismiss cards.
 * Apply writes into the builder draft (the existing save persists it) — nothing
 * changes without the teacher's action (EARNED TRUST).
 *
 * COPILOT-2 M0 generalized the pipeline: every tool returns a `{kind, …}`
 * proposal; `parseProposal` dispatches on `kind`; the parent supplies one
 * `onApplyProposal` router that maps each kind to a builder setter. Adding a
 * tool (add_element, set_artefact, …) is a new `Proposal` variant + a router
 * case — the card + transport are shared.
 *
 * Modeled on `_AnalyticsChat.tsx` (the teacher-auth AG-UI precedent):
 * - **`useTeacherAuth`** on the AGUIProvider — the recurring AIPLA auth corner.
 * - **Slug→UUID resolve** before mounting.
 * - **`activity_id` rides a message prefix** (`[activity_id=…]`), matching the
 *   analytics-chat `[class_id=…]` contract.
 *
 * Dark-flagged: renders null unless `NEXT_PUBLIC_AUTHORING_COPILOT === "1"`.
 * Browser-verify gate: the live SSE tool-result shapes + the Apply round-trips.
 */

"use client";

import { useEffect, useState } from "react";
import { Check, Pencil, Send, Sparkles, X } from "lucide-react";

import { AGUIProvider } from "@/providers/AGUIProvider";
import { useSkillAgent, type ToolCallState } from "@/hooks/useSkillAgent";
import { fetchWithTeacherAuth } from "@/lib/apiClient";

const SKILL_NAME = "activity-authoring-assistant";
const PLATFORM_OWNER_ID = "aipla-platform";

export function authoringCopilotEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AUTHORING_COPILOT === "1";
}

/**
 * A co-pilot proposal. One variant per tool; the parent's `onApplyProposal`
 * router maps each `kind` to a builder setter. Extend the union when adding a
 * tool (COPILOT-2 M1 add_element, M2 set_artefact, …).
 */
export type Proposal =
  | { kind: "set_lesson_prompt"; value: string }
  | { kind: "add_element"; elementKind: "checklist"; items: string[]; label: string }
  | { kind: "set_artefact"; artefactId: string; label: string };

export type ApplyProposal = (proposal: Proposal) => void;

interface AuthoringCopilotProps {
  activityId: string;
  /** Apply router — maps a proposal to the right builder mutation. */
  onApplyProposal: ApplyProposal;
}

/** Public entry. Dark-flagged → renders nothing when disabled (degradation). */
export function AuthoringCopilot(props: AuthoringCopilotProps) {
  if (!authoringCopilotEnabled()) return null;
  return <AuthoringCopilotResolver {...props} />;
}

function AuthoringCopilotResolver({ activityId, onApplyProposal }: AuthoringCopilotProps) {
  const [skillId, setSkillId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolveError(null);
    fetchWithTeacherAuth(
      `/api/proxy/api/skills/by-slug/${encodeURIComponent(PLATFORM_OWNER_ID)}/${encodeURIComponent(SKILL_NAME)}`,
    )
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "The authoring co-pilot skill isn't registered on this environment yet — run scripts/seed-platform-skills.sh."
              : `failed to resolve skill (${res.status})`,
          );
        }
        const body = (await res.json()) as { skillId?: string; skill_id?: string };
        const id = body.skillId ?? body.skill_id;
        if (!id) throw new Error("skill resolution returned no id");
        setSkillId(id);
      })
      .catch((e) => !cancelled && setResolveError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (resolveError) {
    return (
      <div role="alert" className="rounded border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
        {resolveError}
      </div>
    );
  }
  if (!skillId) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="copilot-loading">
        Indlæser medbygger…
      </p>
    );
  }
  return (
    <AGUIProvider key={`${skillId}:${activityId}`} skillId={skillId} useTeacherAuth>
      <AuthoringCopilotInner activityId={activityId} onApplyProposal={onApplyProposal} />
    </AGUIProvider>
  );
}

/** Parse a co-pilot tool result into a typed Proposal, or null. Dispatches on
 *  `proposal.kind` so each tool's result renders + applies through one path. */
export function parseProposal(tc: ToolCallState): Proposal | null {
  if (tc.status !== "success" || !tc.resultContent) return null;
  let r: { ok?: boolean; proposal?: Record<string, unknown> };
  try {
    r = JSON.parse(tc.resultContent);
  } catch {
    return null; // not JSON — no proposal to surface
  }
  if (!r?.ok || !r.proposal || typeof r.proposal.kind !== "string") return null;
  const p = r.proposal;
  switch (p.kind) {
    case "set_lesson_prompt":
      return typeof p.value === "string" && p.field === "teachingGoal" ? { kind: "set_lesson_prompt", value: p.value } : null;
    case "add_element": {
      const items = (p.spec as { items?: unknown })?.items;
      if (p.element_kind === "checklist" && Array.isArray(items) && items.every((s) => typeof s === "string")) {
        return { kind: "add_element", elementKind: "checklist", items: items as string[], label: typeof p.label === "string" ? p.label : "Element" };
      }
      return null;
    }
    case "set_artefact":
      return typeof p.artefactId === "string" && p.artefactId
        ? { kind: "set_artefact", artefactId: p.artefactId, label: typeof p.label === "string" ? p.label : p.artefactId }
        : null;
    default:
      return null; // unknown/unsupported kind (a newer tool than this build)
  }
}

/** A human label for the card header, per proposal kind. */
function proposalTitle(p: Proposal): string {
  switch (p.kind) {
    case "set_lesson_prompt":
      return "Forslag til lærer-prompt";
    case "add_element":
      return `Forslag: ${p.label}`;
    case "set_artefact":
      return "Forslag: brug en simulation";
  }
}

/** Whether the proposal carries free text the teacher can refine inline. */
function proposalEditableText(p: Proposal): string | null {
  return p.kind === "set_lesson_prompt" ? p.value : null;
}

/** Re-build a proposal with edited text (only the editable kinds). */
function withEditedText(p: Proposal, text: string): Proposal {
  return p.kind === "set_lesson_prompt" ? { ...p, value: text } : p;
}

function AuthoringCopilotInner({ activityId, onApplyProposal }: AuthoringCopilotProps) {
  const { messages, toolCalls, sendMessage, isLoading, error } = useSkillAgent();
  const [input, setInput] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    // activity_id rides the message prefix (the analytics-chat contract).
    setInput("");
    await sendMessage(`[activity_id=${activityId}] ${trimmed}`);
  };

  const proposals = toolCalls
    .map((tc) => ({ id: tc.id, proposal: parseProposal(tc) }))
    .filter((p): p is { id: string; proposal: Proposal } => p.proposal !== null);

  return (
    <div className="flex flex-col gap-3" data-testid="authoring-copilot">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Medbygger
      </h2>

      <div className="flex flex-col gap-2" aria-live="polite">
        {messages.map((m) => (
          <article
            key={m.id}
            data-role={m.role}
            className={
              m.role === "user"
                ? "ml-auto max-w-prose rounded border border-border bg-muted px-3 py-2 text-sm"
                : "max-w-prose rounded border border-border bg-background px-3 py-2 text-sm"
            }
          >
            <p className="whitespace-pre-wrap">{stripActivityPrefix(m.content)}</p>
          </article>
        ))}
        {proposals.map((p) => (
          <ProposalCard key={p.id} proposal={p.proposal} onApply={onApplyProposal} />
        ))}
        {isLoading ? <p className="text-xs text-muted-foreground">Tænker…</p> : null}
      </div>

      {error ? (
        <div role="alert" className="rounded border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {error.message}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex items-stretch gap-2">
        <input
          type="text"
          aria-label="Beskriv hvad du vil undervise i"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
          placeholder="Fx: energibevarelse for en B-klasse…"
          className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="flex items-center gap-1.5 rounded border border-border bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          Send
        </button>
      </form>
    </div>
  );
}

/** Apply / Edit / Dismiss card for one proposal. Generic across kinds: free-text
 *  kinds (set_lesson_prompt) get an inline Edit; others are Apply/Dismiss. */
function ProposalCard({ proposal, onApply }: { proposal: Proposal; onApply: ApplyProposal }) {
  const [applied, setApplied] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [editing, setEditing] = useState(false);
  const editable = proposalEditableText(proposal);
  const [draft, setDraft] = useState(editable ?? "");

  if (dismissed) return null;
  if (applied) {
    return (
      <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900" role="status">
        Anvendt ✓ — du kan stadig rette det i feltet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-muted/40 p-3 text-sm" data-testid="proposal-card">
      <p className="text-xs font-medium text-muted-foreground">{proposalTitle(proposal)}</p>
      {editing && editable !== null ? (
        <textarea
          aria-label="Rediger forslag"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
        />
      ) : editable !== null ? (
        <p className="whitespace-pre-wrap">{editable}</p>
      ) : proposal.kind === "add_element" ? (
        <ul className="list-disc pl-5 text-sm" data-testid="proposal-items">
          {proposal.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      ) : proposal.kind === "set_artefact" ? (
        <p className="text-sm" data-testid="proposal-sim">
          {proposal.label}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            onApply(editing ? withEditedText(proposal, draft) : proposal);
            setApplied(true);
          }}
          className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90"
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" /> {editing ? "Brug denne" : "Anvend"}
        </button>
        {editable !== null && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs hover:bg-muted"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Rediger
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" /> Afvis
        </button>
      </div>
    </div>
  );
}

/** Hide the `[activity_id=…] ` prefix from the rendered user bubble. */
function stripActivityPrefix(content: string): string {
  const m = content.match(/^\[activity_id=[^\]]+\]\s*/);
  return m ? content.slice(m[0].length) : content;
}
