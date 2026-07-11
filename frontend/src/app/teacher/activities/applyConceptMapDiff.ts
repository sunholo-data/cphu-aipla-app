import type { ConceptMapEditorValue, ConceptNodeRow } from "@/components/teacher/ConceptMapEditor";

/** The co-pilot's concept-map DIFF (CONCEPT-1 M2) — the normalised `diff` field
 *  of a `propose_concept_map` proposal. Co-authoring semantics: it patches the
 *  builder's CURRENT map (which may hold unsaved teacher edits), it does not
 *  replace it. Mirrors backend `propose_concept_map`'s wire shape. */
export interface ConceptMapDiff {
  title?: string | null;
  addNodes?: { id: string; label: string; checkQuestions?: { prompt: string; expectedAnswer?: string }[] }[];
  addEdges?: { from: string; to: string }[];
  removeNodes?: string[];
  relabel?: { id: string; label: string }[];
  setCheckQuestions?: { nodeId: string; questions: { prompt: string; expectedAnswer?: string }[] }[];
}

function toQuestionRows(
  questions: { prompt: string; expectedAnswer?: string }[] | undefined,
  nextKey: () => number,
): ConceptNodeRow["questions"] {
  return (questions ?? [])
    .filter((q) => q.prompt.trim())
    .map((q) => ({ key: nextKey(), prompt: q.prompt, expectedAnswer: q.expectedAnswer ?? "" }));
}

/**
 * Apply a co-pilot diff to the builder's concept-map editor state — the Apply
 * half of the propose→apply loop. Same op order as the backend validation
 * (remove → relabel → set questions → add nodes → add edges → title). Ops
 * referencing ids that don't exist locally are skipped, not errors: the server
 * validated the diff against the SAVED map, and the local draft may have
 * drifted — applying what still fits beats refusing the whole proposal.
 */
export function applyConceptMapDiff(
  current: ConceptMapEditorValue | null,
  diff: ConceptMapDiff,
  nextKey: () => number,
): ConceptMapEditorValue {
  const removed = new Set(diff.removeNodes ?? []);
  let nodes: ConceptNodeRow[] = (current?.nodes ?? [])
    .filter((n) => !removed.has(n.id))
    .map((n) => ({ ...n, dependsOn: n.dependsOn.filter((d) => !removed.has(d)) }));

  for (const r of diff.relabel ?? []) {
    nodes = nodes.map((n) => (n.id === r.id && r.label.trim() ? { ...n, label: r.label } : n));
  }
  for (const sq of diff.setCheckQuestions ?? []) {
    nodes = nodes.map((n) => (n.id === sq.nodeId ? { ...n, questions: toQuestionRows(sq.questions, nextKey) } : n));
  }

  const ids = new Set(nodes.map((n) => n.id));
  for (const add of diff.addNodes ?? []) {
    if (!add.label.trim() || ids.has(add.id)) continue; // id collision → the node already exists locally
    ids.add(add.id);
    nodes.push({
      key: nextKey(),
      id: add.id,
      label: add.label,
      dependsOn: [],
      questions: toQuestionRows(add.checkQuestions, nextKey),
    });
  }

  for (const e of diff.addEdges ?? []) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    nodes = nodes.map((n) =>
      n.id === e.to && !n.dependsOn.includes(e.from) ? { ...n, dependsOn: [...n.dependsOn, e.from] } : n,
    );
  }

  return {
    title: typeof diff.title === "string" && diff.title.trim() ? diff.title : (current?.title ?? ""),
    nodes,
  };
}
