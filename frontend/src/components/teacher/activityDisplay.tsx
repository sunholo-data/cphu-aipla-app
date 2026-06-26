import type { ActivityPayload } from "@/lib/teacherApi";

/**
 * Shared, purely presentational bits of an activity card — the composition row
 * (what the activity is made of) and the visibility vocabulary/pill. Used by both
 * the teacher library (`/teacher/activities`, editable own cards) and the
 * researcher Research view (`/teacher/research/activities`, read-only), so the
 * two surfaces render an activity identically.
 */

/** Friendly names for the catalogued sim artefacts (fallback: the raw id). */
export const SIM_NAMES: Record<string, string> = {
  boldkast: "Boldkast",
  "led-planck": "LED-Planck",
  kinebot: "KineBot",
};

/** The element fields we surface as composition badges, in display order. */
export const ELEMENT_BADGES: { field: keyof ActivityPayload; label: string }[] = [
  { field: "checklist", label: "Checklist" },
  { field: "table", label: "Table" },
  { field: "chart", label: "Chart" },
  { field: "calculator", label: "Calculator" },
  { field: "note", label: "Note" },
  { field: "solution", label: "Solution" },
];

/**
 * What an activity is *made of* — the sim artefact, the teacher-authored
 * workbench elements, and any documents/materials. Derived entirely from the
 * listing payload (no extra fetch), so a teacher can see at a glance what each
 * activity uses without opening the editor.
 */
export function composition(a: ActivityPayload): { key: string; label: string; kind: "sim" | "element" | "docs" }[] {
  const out: { key: string; label: string; kind: "sim" | "element" | "docs" }[] = [];
  if (a.artefactId) out.push({ key: "sim", label: SIM_NAMES[a.artefactId] ?? a.artefactId, kind: "sim" });
  for (const { field, label } of ELEMENT_BADGES) {
    const value = a[field];
    if (Array.isArray(value) && value.length > 0) {
      out.push({ key: field, label: value.length > 1 ? `${label} ${value.length}` : label, kind: "element" });
    }
  }
  const docs = (a.document?.length ?? 0) + (a.materials?.length ?? 0);
  if (docs > 0) out.push({ key: "docs", label: docs > 1 ? `${docs} documents` : "1 document", kind: "docs" });
  return out;
}

/** The composition row: sim artefact + workbench elements + documents. */
export function CompositionRow({ activity }: { activity: ActivityPayload }) {
  const parts = composition(activity);
  if (parts.length === 0) {
    return <p className="text-[11px] italic text-muted-foreground">Chat only — no workbench elements</p>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {parts.map((p) => (
        <span
          key={p.key}
          className={
            p.kind === "sim"
              ? "rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
              : "rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
          }
        >
          {p.label}
        </span>
      ))}
    </div>
  );
}

/** Visibility vocabulary shared by the read-only badge and the editable control.
 *  Backend value ``published`` reads as "Shared" on teacher surfaces — the
 *  audience is colleagues, via the "Shared activities" catalogue. */
export const VISIBILITY_LABEL: Record<ActivityPayload["visibility"], string> = {
  draft: "Draft",
  private: "Private",
  published: "Shared",
};

export function visibilityColor(v: ActivityPayload["visibility"]): string {
  if (v === "draft")
    return "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  if (v === "published")
    return "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
  return "border-border bg-muted text-muted-foreground"; // private
}

/** Read-only status pill — all three states are labelled (private is no longer
 *  an invisible blank). Used in the research view and anywhere without a control. */
export function VisibilityBadge({ visibility }: { visibility: ActivityPayload["visibility"] }) {
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium ${visibilityColor(visibility)}`}>
      {VISIBILITY_LABEL[visibility]}
    </span>
  );
}
