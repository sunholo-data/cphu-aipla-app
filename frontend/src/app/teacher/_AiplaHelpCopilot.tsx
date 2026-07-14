"use client";

import { TeacherCopilot } from "@/components/teacher/copilot";
import { useTeacherFeature } from "@/hooks/useTeacherFeature";

/**
 * Always-available "AIPLA help" co-pilot — floats on every teacher/researcher
 * surface (mounted in the shell) so anyone can ask how to use the platform
 * right where they're working. Pure Q&A: it streams the read-only `aipla-help`
 * skill (its how-to knowledge is in the skill instructions) and emits no
 * proposals — nothing to Apply. Both teachers and researchers see it (a
 * researcher is a Firebase teacher with an extra claim), which is why it lives
 * in the shell and not on a single page.
 *
 * Flag-gated like the authoring co-pilot (NEXT_PUBLIC_AIPLA_HELP; "beta" opts in
 * per teacher). The chrome is Danish-first for the pilot audience; the skill
 * itself replies in whichever language the user writes in.
 */
export function AiplaHelpCopilot() {
  const enabled = useTeacherFeature("aiplaHelp", process.env.NEXT_PUBLIC_AIPLA_HELP);
  if (!enabled) return null;
  return (
    <TeacherCopilot
      skillName="aipla-help"
      title="AIPLA Hjælp"
      persistKey="aipla-help"
      placeholder="Spørg om hvordan du bruger AIPLA…"
      emptyText="Spørg mig om hvordan du bruger AIPLA — opret en klasse, byg en aktivitet, tilføj materialer, brug medbyggeren, eller (for forskere) forskervisningerne. Jeg svarer på dansk eller engelsk. De fulde vejledninger ligger under Guides."
    />
  );
}
