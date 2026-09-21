import { type Stage, copy, stageTone } from "@/lib/onboardingStage";

const TONE: Record<ReturnType<typeof stageTone>, string> = {
  muted: "border-border bg-muted/40 text-muted-foreground",
  amber: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  green: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
};

/** The onboarding-stage pill (1.1.124). `label` overrides the plain stage
 *  name — the Programme column passes "Demo only — 9 days". */
export function StageChip({ stage, label, title }: { stage: Stage; label?: string; title?: string }) {
  return (
    <span
      data-testid="stage-chip"
      data-stage={stage}
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium ${TONE[stageTone(stage)]}`}
    >
      {label ?? copy.label[stage]}
    </span>
  );
}
