import type { ProposalDescriptor } from "@/components/teacher/copilot";
import type { ToolCallState } from "@/hooks/useSkillAgent";

/**
 * A tutor co-pilot proposal (1.1.91 M2).
 *
 * The backend tools are propose-only: they emit `{ok, proposal:{kind,…}}` and
 * persist nothing. The researcher Applies the card, and the Apply hands the
 * proposal to the structure editor — it does NOT write. That keeps the existing
 * researcher-gated `PUT .../structure` the only path to a stored change, and
 * keeps the preview a researcher signs off on identical to what they saved.
 *
 * ⚠️ **A proposal never carries a citation.** The backend strips every source
 * field a model attaches before the proposal exists, so there is nothing to
 * parse here and nothing to render. `needsVouching` is the note that says so,
 * and it is shown on the card rather than hidden — a researcher has to see that
 * the provenance is theirs to supply.
 */
export type TutorProposal =
  | {
      kind: "propose_approach";
      label: string;
      summary: string;
      constructNames: string[];
      needsVouching: string;
    }
  | {
      kind: "propose_behaviours";
      constructName: string;
      behaviours: string[];
      avoid: string[];
    };

export function parseTutorProposal(tc: ToolCallState): TutorProposal | null {
  if (tc.status !== "success" || !tc.resultContent) return null;
  let parsed: { ok?: boolean; proposal?: Record<string, unknown> };
  try {
    parsed = JSON.parse(tc.resultContent);
  } catch {
    return null; // a read tool's result (critique, passages) — no card
  }
  const p = parsed?.proposal;
  if (!parsed?.ok || !p || typeof p.kind !== "string") return null;

  if (p.kind === "propose_approach" && typeof p.label === "string") {
    const constructs = Array.isArray(p.constructs) ? p.constructs : [];
    return {
      kind: "propose_approach",
      label: p.label,
      summary: typeof p.summary === "string" ? p.summary : "",
      constructNames: constructs
        .map((c) => (c && typeof c === "object" ? String((c as { name?: unknown }).name ?? "") : ""))
        .filter(Boolean),
      needsVouching: typeof p.needsVouching === "string" ? p.needsVouching : "",
    };
  }

  if (p.kind === "propose_behaviours" && typeof p.constructName === "string") {
    const behaviours = Array.isArray(p.behaviours) ? p.behaviours : [];
    return {
      kind: "propose_behaviours",
      constructName: p.constructName,
      behaviours: behaviours
        .map((b) => (b && typeof b === "object" ? String((b as { text?: unknown }).text ?? "") : String(b ?? "")))
        .filter(Boolean),
      avoid: (Array.isArray(p.avoid) ? p.avoid : []).map((a) => String(a)).filter(Boolean),
    };
  }
  return null;
}

/** UI copy, lifted out of JSX (1.1.108 M4) so a translator can reach it. */
const copy = {
  approachTitle: (label: string, n: number) =>
    `New approach: ${label} — ${n} construct${n === 1 ? "" : "s"}`,
  behavioursTitle: (name: string, n: number) =>
    `${n} behaviour${n === 1 ? "" : "s"} for “${name}”`,
  constructs: "Constructs",
  avoid: "Avoid",
  noSource: "No source attached",
} as const;

export const tutorProposalDescriptor: ProposalDescriptor<TutorProposal> = {
  title: (p) =>
    p.kind === "propose_approach"
      ? copy.approachTitle(p.label, p.constructNames.length)
      : copy.behavioursTitle(p.constructName, p.behaviours.length),
  // The approach's SUMMARY is the free-text a researcher most often wants to
  // reword before applying. Behaviour lists are structured, so they are edited
  // in the structure editor after Apply rather than as one blob here.
  editableText: (p) => (p.kind === "propose_approach" ? p.summary : null),
  withEditedText: (p, text) => (p.kind === "propose_approach" ? { ...p, summary: text } : p),
};
