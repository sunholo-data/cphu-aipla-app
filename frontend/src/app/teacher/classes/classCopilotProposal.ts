import type { ProposalDescriptor } from "@/components/teacher/copilot";
import type { ToolCallState } from "@/hooks/useSkillAgent";
import { createClass, mintGroupCodes } from "@/lib/teacherApi";

/**
 * A manage-class co-pilot proposal. The backend write tools (`create_class`,
 * `mint_group_codes`) are propose-only — they emit `{ok, proposal:{kind,…}}`
 * and persist nothing; the teacher Applies the card and the Apply does the real
 * REST write (the same endpoints the dashboard uses). See
 * docs/design/aipla/v1.1.0-feedback/teacher-coworking-copilot.md.
 */
export type ClassProposal =
  | { kind: "create_class"; name: string; description: string | null }
  | { kind: "mint_codes"; classId: string; className: string; count: number };

/** Parse one tool-call result into a typed class proposal, or null. Mirrors the
 *  activity co-pilot's `parseProposal`: read `tc.resultContent`, require
 *  `ok === true` + a known `proposal.kind`. */
export function parseClassProposal(tc: ToolCallState): ClassProposal | null {
  if (tc.status !== "success" || !tc.resultContent) return null;
  let parsed: { ok?: boolean; proposal?: Record<string, unknown> };
  try {
    parsed = JSON.parse(tc.resultContent);
  } catch {
    return null; // not JSON (e.g. a read tool's plain result) — no card
  }
  const p = parsed?.proposal;
  if (!parsed?.ok || !p || typeof p.kind !== "string") return null;

  if (p.kind === "create_class" && typeof p.name === "string") {
    return {
      kind: "create_class",
      name: p.name,
      description: typeof p.description === "string" ? p.description : null,
    };
  }
  if (p.kind === "mint_codes" && typeof p.class_id === "string" && typeof p.count === "number") {
    return {
      kind: "mint_codes",
      classId: p.class_id,
      className: typeof p.class_name === "string" ? p.class_name : p.class_id,
      count: p.count,
    };
  }
  return null;
}

/** How the shared ProposalCard renders + edits a class proposal. The class name
 *  is editable inline before Apply; mint has nothing free-text to edit. */
export const classProposalDescriptor: ProposalDescriptor<ClassProposal> = {
  title: (p) =>
    p.kind === "create_class"
      ? `New class${p.description ? ` · ${p.description}` : ""}`
      : `Mint ${p.count} join-code${p.count === 1 ? "" : "s"} for ${p.className}`,
  editableText: (p) => (p.kind === "create_class" ? p.name : null),
  withEditedText: (p, text) => (p.kind === "create_class" ? { ...p, name: text } : p),
};

/** Commit a class proposal via the same REST endpoints the dashboard uses. The
 *  caller refetches the class list afterwards so the effect is visible. */
export async function applyClassProposal(proposal: ClassProposal): Promise<void> {
  if (proposal.kind === "create_class") {
    await createClass({ name: proposal.name, description: proposal.description ?? undefined });
    return;
  }
  await mintGroupCodes(proposal.classId, proposal.count);
}
