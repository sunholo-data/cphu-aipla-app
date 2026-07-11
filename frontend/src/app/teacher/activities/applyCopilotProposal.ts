import type { ActivityBuilder } from "@/hooks/useActivityBuilder";

import { applyConceptMapDiff } from "./applyConceptMapDiff";
import type { Proposal } from "./[id]/_AuthoringCopilot";

/**
 * The single Apply router shared by the create (`/new`) and configure (`[id]`)
 * builder pages: map a co-pilot proposal to the exact builder mutation a human
 * would make. When a new element is added, this is the one "Apply-router case" the
 * element recipe (activity-elements-palette.md step 5b) points at.
 */
export function applyCopilotProposal(p: Proposal, builder: ActivityBuilder): void {
  if (p.kind === "set_lesson_prompt") {
    builder.setTeachingGoal(p.value);
  } else if (p.kind === "add_element") {
    if (p.elementKind === "checklist") builder.addChecklistItems(p.items);
    else if (p.elementKind === "note") builder.setNote({ title: p.title, body: p.body });
    else if (p.elementKind === "solution") builder.setSolution({ prompt: p.prompt });
    else if (p.elementKind === "document") builder.setDocument({ prompt: p.prompt });
    else if (p.elementKind === "table")
      builder.setTable({ title: p.title, columns: p.columns.map((c, i) => ({ key: i + 1, ...c })), rows: p.rows });
    else if (p.elementKind === "chart") builder.setChart({ title: p.title, chartKind: p.chartKind });
    else if (p.elementKind === "calculator")
      builder.setCalculator({
        title: p.title,
        formula: p.formula,
        inputs: p.inputs.map((inp, i) => ({ key: i + 1, ...inp })),
      });
  } else if (p.kind === "set_artefact") {
    builder.setArtefactId(p.artefactId);
  } else if (p.kind === "propose_concept_map") {
    // Co-authoring: the diff patches the CURRENT builder map (which may hold
    // unsaved teacher edits) — it never replaces it wholesale.
    builder.setConceptMap(applyConceptMapDiff(builder.conceptMap, p.diff, builder.nextElementKey));
  } else if (p.kind === "attach_material") {
    // Append a curriculum reference the tutor grounds on (RAG). Dedup by docId so
    // re-applying the same proposal doesn't stack duplicates.
    const exists = builder.materials.some((m) => m.docId === p.docId && (m.kind ?? "curriculum") === "curriculum");
    if (!exists) {
      builder.setMaterials([
        ...builder.materials,
        { kind: "curriculum", docId: p.docId, origin: p.origin, studentVisible: false },
      ]);
    }
  }
}
