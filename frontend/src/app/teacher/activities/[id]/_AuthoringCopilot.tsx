/**
 * `AuthoringCopilot` — the teacher-facing AG-UI chat island for the activity
 * builder (COPILOT-1 M3; designs 1.1.39 + 1.1.50).
 *
 * The teacher describes what they want to teach; the co-pilot calls
 * `set_lesson_prompt` (backend M1) and the proposal surfaces here as an
 * **Apply / Edit / Dismiss** card. Apply writes the value into the builder's
 * `teachingGoal` (the existing save persists it) — nothing changes without the
 * teacher's action (EARNED TRUST).
 *
 * Modeled on `_AnalyticsChat.tsx` (the teacher-auth AG-UI precedent):
 * - **`useTeacherAuth`** on the AGUIProvider — the recurring AIPLA auth corner
 *   (a group token would 401 the stream). Regression-guarded in the tests.
 * - **Slug→UUID resolve** before mounting (the stream route wants the Firestore id).
 * - **`activity_id` rides a message prefix** (`[activity_id=…]`), matching the
 *   analytics-chat `[class_id=…]` contract — the agent reads context from the
 *   message, the same shape across surfaces.
 *
 * Dark-flagged: returns null unless `NEXT_PUBLIC_AUTHORING_COPILOT === "1"`, so
 * the builder is fully usable with the co-pilot disabled (GRACEFUL DEGRADATION)
 * until the researcher teaching framework lands (1.1.50 human gate).
 *
 * Browser-verify gate: the live SSE `set_lesson_prompt` tool-result shape +
 * the Apply→save round-trip. Unit tests cover the panel wiring + the card.
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

interface AuthoringCopilotProps {
  activityId: string;
  /** Apply target — writes the proposed lesson prompt into the builder draft. */
  onApplyLessonPrompt: (value: string) => void;
}

/** Public entry. Dark-flagged → renders nothing when disabled (degradation). */
export function AuthoringCopilot(props: AuthoringCopilotProps) {
  if (!authoringCopilotEnabled()) return null;
  return <AuthoringCopilotResolver {...props} />;
}

function AuthoringCopilotResolver({ activityId, onApplyLessonPrompt }: AuthoringCopilotProps) {
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
      <AuthoringCopilotInner activityId={activityId} onApplyLessonPrompt={onApplyLessonPrompt} />
    </AGUIProvider>
  );
}

/** Pull the proposed teaching goal out of a successful set_lesson_prompt call. */
export function parseLessonProposal(tc: ToolCallState): string | null {
  if (tc.name !== "set_lesson_prompt" || tc.status !== "success" || !tc.resultContent) return null;
  try {
    const r = JSON.parse(tc.resultContent) as { ok?: boolean; proposal?: { field?: string; value?: unknown } };
    if (r?.ok && r.proposal?.field === "teachingGoal" && typeof r.proposal.value === "string") {
      return r.proposal.value;
    }
  } catch {
    /* not JSON — no proposal to surface */
  }
  return null;
}

function AuthoringCopilotInner({ activityId, onApplyLessonPrompt }: AuthoringCopilotProps) {
  const { messages, toolCalls, sendMessage, isLoading, error } = useSkillAgent();
  const [input, setInput] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    // activity_id rides the message prefix (the analytics-chat contract) so the
    // agent passes it to set_lesson_prompt(activity_id=…).
    setInput("");
    await sendMessage(`[activity_id=${activityId}] ${trimmed}`);
  };

  const proposals = toolCalls
    .map((tc) => ({ id: tc.id, value: parseLessonProposal(tc) }))
    .filter((p): p is { id: string; value: string } => p.value !== null);

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
          <ProposalCard key={p.id} value={p.value} onApply={onApplyLessonPrompt} />
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

/** Apply / Edit / Dismiss card for one proposed lesson prompt. Self-contained:
 *  Edit refines the text inline before applying — no parent focus wiring. */
function ProposalCard({ value, onApply }: { value: string; onApply: (v: string) => void }) {
  const [applied, setApplied] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (dismissed) return null;
  if (applied) {
    return (
      <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900" role="status">
        Lærer-prompt anvendt ✓ — du kan stadig rette i den i feltet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-muted/40 p-3 text-sm" data-testid="proposal-card">
      <p className="text-xs font-medium text-muted-foreground">Forslag til lærer-prompt</p>
      {editing ? (
        <textarea
          aria-label="Rediger lærer-prompt"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
        />
      ) : (
        <p className="whitespace-pre-wrap">{value}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            onApply(editing ? draft : value);
            setApplied(true);
          }}
          className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90"
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" /> {editing ? "Brug denne" : "Anvend"}
        </button>
        {!editing ? (
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
