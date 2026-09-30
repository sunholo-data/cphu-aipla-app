import { useT, type Translate } from "@/i18n";
import type { ActivityPayload } from "@/lib/teacherApi";

/**
 * Shared, purely presentational bits of an activity card — the composition row
 * (what the activity is made of) and the visibility vocabulary/pill. Used by both
 * the teacher library (`/teacher/activities`, editable own cards) and the
 * researcher Research view (the library's scope toggle since 1.1.125), so the
 * two surfaces render an activity identically.
 */

/** Friendly names for the catalogued sim artefacts (fallback: the raw id). */
export const SIM_NAMES: Record<string, string> = {
  boldkast: "Boldkast",
  "led-planck": "LED-Planck",
  kinebot: "KineBot",
};

/** The element fields we surface as composition badges, in display order. */
// 1.1.108 M2 — the badge label is a message key (namespace ActivityDisplay).
export const ELEMENT_BADGES: { field: keyof ActivityPayload & ("checklist" | "table" | "chart" | "calculator" | "note" | "solution") }[] = [
  { field: "checklist" },
  { field: "table" },
  { field: "chart" },
  { field: "calculator" },
  { field: "note" },
  { field: "solution" },
];

/**
 * What an activity is *made of* — the sim artefact, the teacher-authored
 * workbench elements, and any documents/materials. Derived entirely from the
 * listing payload (no extra fetch), so a teacher can see at a glance what each
 * activity uses without opening the editor.
 */
export function composition(
  a: ActivityPayload,
  t: Translate<"ActivityDisplay">,
): { key: string; label: string; kind: "sim" | "element" | "docs" }[] {
  const out: { key: string; label: string; kind: "sim" | "element" | "docs" }[] = [];
  if (a.artefactId) out.push({ key: "sim", label: SIM_NAMES[a.artefactId] ?? a.artefactId, kind: "sim" });
  for (const { field } of ELEMENT_BADGES) {
    const value = a[field];
    const label = t(field);
    if (Array.isArray(value) && value.length > 0) {
      out.push({
        key: field,
        label: value.length > 1 ? t("elementCount", { label, count: value.length }) : label,
        kind: "element",
      });
    }
  }
  const docs = (a.document?.length ?? 0) + (a.materials?.length ?? 0);
  if (docs > 0) out.push({ key: "docs", label: t("documents", { count: docs }), kind: "docs" });
  return out;
}

/** The composition row: sim artefact + workbench elements + documents. */
export function CompositionRow({ activity }: { activity: ActivityPayload }) {
  const t = useT("ActivityDisplay");
  const parts = composition(activity, t);
  if (parts.length === 0) {
    return <p className="text-[11px] italic text-muted-foreground">{t("chatOnly")}</p>;
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
/** The visibility word, in the teacher's language (1.1.108 M2). */
export function visibilityLabel(t: Translate<"ActivityDisplay">, v: ActivityPayload["visibility"]): string {
  return t(`visibility_${v}`);
}

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
  const t = useT("ActivityDisplay");
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium ${visibilityColor(visibility)}`}>
      {visibilityLabel(t, visibility)}
    </span>
  );
}
