"use client";

import { TeacherCopilot } from "@/components/teacher/copilot";

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
  return (
    <TeacherCopilot
      skillName="aipla-help"
      title="AIPLA Hjælp"
      persistKey="aipla-help"
      align="left"
      onClose={onClose}
      placeholder="Spørg om hvordan du bruger AIPLA…"
      emptyText="Spørg mig om hvordan du bruger AIPLA — opret en klasse, byg en aktivitet, tilføj materialer, brug medbyggeren, eller (for forskere) forskervisningerne. Jeg svarer på dansk eller engelsk. De fulde vejledninger ligger under Guides."
    />
  );
}
