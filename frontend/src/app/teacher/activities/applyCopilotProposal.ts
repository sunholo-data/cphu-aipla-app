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
    // 1.1.73 — writing fields are a LIST (cap 3). APPEND, like charts: a
    // teacher asking for a conclusion box after a method box must not silently
    // lose the first one. `id: ""` marks it as unsaved so the payload builder
    // mints a stable id from the client key rather than a positional one.
    else if (p.elementKind === "writing")
      builder.setWriting([
        ...builder.writing,
        { key: builder.nextElementKey(), id: "", title: p.title, prompt: p.prompt, minWords: p.minWords },
      ]);
    else if (p.elementKind === "solution") builder.setSolution({ prompt: p.prompt });
    else if (p.elementKind === "document") builder.setDocument({ prompt: p.prompt });
    else if (p.elementKind === "table")
      builder.setTable({ title: p.title, columns: p.columns.map((c, i) => ({ key: i + 1, ...c })), rows: p.rows });
    // 1.1.64 — charts are a list. APPEND rather than replace, so proposing a
    // second chart does not silently delete the first (the same full-overwrite
    // shape as the activity POST).
    else if (p.elementKind === "chart")
      builder.setChart([
        ...builder.chart,
        {
          id: `chart-${builder.chart.length + 1}`,
          title: p.title,
          chartKind: p.chartKind,
          xColumn: p.xColumn ?? null,
          yColumn: p.yColumn ?? null,
          tableId: p.xColumn || p.yColumn ? "table-1" : null,
        },
      ]);
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
        // 1.1.63 M1 — cache the title so the tutor cites by it. Falls back to
        // the proposal's display label for older proposals that predate the
        // dedicated field.
        { kind: "curriculum", docId: p.docId, origin: p.origin, title: p.title ?? p.label, studentVisible: false },
      ]);
    }
  } else if (p.kind === "set_activity_facets") {
    // 1.1.61 — file the activity the co-pilot just composed. Own facets only;
    // an unset field in the proposal leaves the current value alone rather than
    // clearing it, so applying "add the tag lab" cannot drop a subject the
    // teacher set by hand.
    if (p.subject !== null) builder.setSubject(p.subject);
    if (p.level !== null) builder.setLevel(p.level);
    if (p.tags.length) builder.setTags(Array.from(new Set([...builder.tags, ...p.tags])));
  }
}
