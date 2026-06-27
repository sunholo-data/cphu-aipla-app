"use client";

import { useState } from "react";
import { Send } from "lucide-react";

import { AGUIProvider } from "@/providers/AGUIProvider";
import { useSkillAgent } from "@/hooks/useSkillAgent";
import { useSkillSlugResolver } from "@/hooks/useSkillSlugResolver";

import { FloatingCopilot } from "./FloatingCopilot";
import { ProposalCard } from "./ProposalCard";
import { DEFAULT_LABELS, type TeacherCopilotConfig } from "./types";

/**
 * Shared teacher co-pilot — a floating, propose/Apply chat partner that drops
 * onto any teacher surface (class management, activity authoring, analytics).
 * The shell owns the panel, slug→UUID resolution, teacher auth, the AG-UI chat
 * transport, and the proposal cards; each surface supplies only its config
 * (skill slug, scope prefix, proposal parser + descriptor, apply router).
 *
 * Design: docs/design/aipla/v1.1.0-feedback/teacher-coworking-copilot.md.
 */
export function TeacherCopilot<P>(config: TeacherCopilotConfig<P>) {
  return (
    <FloatingCopilot title={config.title}>
      <CopilotResolver {...config} />
    </FloatingCopilot>
  );
}

/**
 * Resolve the skill slug to its per-environment Firestore UUID (the stream
 * endpoint keys on UUID, not slug), then mount the teacher-auth AG-UI provider.
 */
function CopilotResolver<P>(config: TeacherCopilotConfig<P>) {
  const { skillId, resolveError } = useSkillSlugResolver(config.skillName);

  if (resolveError) {
    return (
      <div role="alert" className="m-3 rounded border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
        {resolveError}
      </div>
    );
  }
  if (!skillId) {
    return (
      <p data-testid="copilot-loading" className="p-3 text-sm text-muted-foreground">
        {DEFAULT_LABELS.thinking}
      </p>
    );
  }
  return (
    <AGUIProvider key={skillId} skillId={skillId} useTeacherAuth>
      <CopilotChat {...config} />
    </AGUIProvider>
  );
}

function CopilotChat<P>(config: TeacherCopilotConfig<P>) {
  const labels = { ...DEFAULT_LABELS, ...config.labels };
  const { messages, toolCalls, sendMessage, isLoading, error } = useSkillAgent();
  const [input, setInput] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput("");
    await sendMessage(`${config.scopePrefix ?? ""}${trimmed}`);
  };

  const proposals = toolCalls
    .map((tc) => ({ id: tc.id, proposal: config.parseProposal(tc) }))
    .filter((p): p is { id: string; proposal: P } => p.proposal !== null);

  const empty = messages.length === 0 && proposals.length === 0 && !isLoading;
  const strip = config.stripPrefix ?? ((c: string) => c);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="teacher-copilot">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3" aria-live="polite">
        {empty ? <p className="text-xs text-muted-foreground">{config.emptyText}</p> : null}
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
            <p className="whitespace-pre-wrap">{m.role === "user" ? strip(m.content) : m.content}</p>
          </article>
        ))}
        {proposals.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p.proposal}
            descriptor={config.proposalDescriptor}
            onApply={config.onApplyProposal}
            labels={config.labels}
          />
        ))}
        {isLoading ? <p className="text-xs text-muted-foreground">{labels.thinking}</p> : null}
      </div>

      {error ? (
        <div role="alert" className="mx-3 mb-1 rounded border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {error.message}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex items-stretch gap-2 border-t border-border p-2">
        <input
          type="text"
          aria-label={config.placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
          placeholder={config.placeholder}
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
