"use client";

import { useEffect, useState } from "react";

import { TeacherCopilot } from "@/components/teacher/copilot";
import { type StagePayload } from "@/lib/onboardingStage";
import { fetchTeacherStage } from "@/lib/teacherApi";

// 1.1.124 M3 — the teacher's onboarding stage rides along as hidden context, so
// "how do I start?" is answered with the NEXT step rather than the whole guide.
// Machine-readable delimiters, stripped from the rendered bubble; same shape as
// the authoring co-pilot's [[activity_draft]] block.
const STAGE_OPEN = "[[stage]]";
const STAGE_CLOSE = "[[/stage]]";

function stageBlock(stage: StagePayload | null): string {
  if (!stage) return "";
  return `${STAGE_OPEN}${JSON.stringify({ stage: stage.stage, nextStep: stage.nextStep })}${STAGE_CLOSE}\n`;
}

export function stripStagePrefix(content: string): string {
  if (!content.startsWith(STAGE_OPEN)) return content;
  const close = content.indexOf(STAGE_CLOSE);
  return close === -1 ? content : content.slice(close + STAGE_CLOSE.length).replace(/^\s+/, "");
}

// A "how do I…" question belongs in chat (the skill answers it); an actual bug
// belongs in an inbox someone reads. mailto: rather than a chat tool: outbound
// email (Mailgun) exists in the template but isn't confirmed live for AIPLA's
// deployed envs, and this needs to ship without that dependency. Reports go
// straight to the teacher's own email client, pre-addressed and subjected.
const FEEDBACK_MAILTO =
  "mailto:mark.edmondson@ind.ku.dk?subject=" +
  encodeURIComponent("AIPLA feedback") +
  "&body=" +
  encodeURIComponent("What happened, and what did you expect instead?\n\n(Which page were you on?)\n\n");

/**
 * The "AIPLA Hjælp" help co-pilot — a pure-Q&A assistant grounded in the how-to
 * guides (knowledge lives in the `aipla-help` skill instructions; it replies in
 * the user's language). Opened on demand from the "Hjælp" button in the teacher
 * header (the shell owns the open state + the feature flag), so it never floats
 * over the work co-pilots. It opens bottom-LEFT — clear of the authoring /
 * manage / analytics co-pilots (bottom-right) — and closes (unmounts) via the X;
 * the conversation resumes on reopen (thread id persisted).
 */
export function AiplaHelpCopilot({ onClose }: { onClose: () => void }) {
  const [stage, setStage] = useState<StagePayload | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchTeacherStage()
      .then((s) => {
        if (!cancelled) setStage(s);
      })
      .catch(() => {
        /* no context is fine — the skill answers from the guides alone */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <TeacherCopilot
      skillName="aipla-help"
      scopePrefix={stageBlock(stage)}
      stripPrefix={stripStagePrefix}
      title="AIPLA Hjælp"
      persistKey="aipla-help"
      align="left"
      onClose={onClose}
      placeholder="Spørg om hvordan du bruger AIPLA…"
      emptyText="Spørg mig om hvordan du bruger AIPLA — opret en klasse, byg en aktivitet, tilføj materialer, brug medbyggeren, eller (for forskere) forskervisningerne. Jeg svarer på dansk eller engelsk. De fulde vejledninger ligger under Guides."
      helpLink={{ href: FEEDBACK_MAILTO, label: "Report a bug / send feedback" }}
    />
  );
}
