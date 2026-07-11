"use client";

// ConceptMapEditor — the teacher-builder editor for the living concept map
// (living-concept-map M0, list mode). The LIST is the authoring on-ramp: add
// concepts, mark "builds on" inline, optionally attach chat-native check
// questions per concept. The graph below is the same auto-layout display the
// student sees — a projection of the same {nodes, edges} data, never a second
// data shape. Drag-to-edit graph mode is deferred by design.

import { Map as MapIcon, Plus, X } from "lucide-react";

import { ConceptMapGraph } from "@/components/workspace/ConceptMapGraph";

export interface ConceptQuestionRow {
  key: number;
  prompt: string;
  expectedAnswer: string;
}

export interface ConceptNodeRow {
  key: number;
  /** Stable node id — minted on add, preserved through hydrate. Edges and the
   *  M3 checkpoint state key on it, so it must survive relabels/reorders. */
  id: string;
  label: string;
  /** Prerequisite node ids ("builds on"). */
  dependsOn: string[];
  questions: ConceptQuestionRow[];
}

export interface ConceptMapEditorValue {
  title: string;
  nodes: ConceptNodeRow[];
}

/** True when making `nodeId` depend on `depId` would create a cycle: i.e. the
 *  candidate prerequisite already (transitively) builds on this node. */
export function wouldCreateCycle(nodes: ConceptNodeRow[], nodeId: string, depId: string): boolean {
  if (nodeId === depId) return true;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const stack = [depId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === nodeId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const dep of byId.get(cur)?.dependsOn ?? []) stack.push(dep);
  }
  return false;
}

interface ConceptMapEditorProps {
  value: ConceptMapEditorValue | null;
  onChange: (value: ConceptMapEditorValue | null) => void;
  /** Mints unique client keys/ids; shared with the builder's key counter. */
  nextKey: () => number;
}

export function ConceptMapEditor({ value, onChange, nextKey }: ConceptMapEditorProps) {
  if (!value) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Concept map (optional)</span>
          <button
            type="button"
            onClick={() => onChange({ title: "", nodes: [] })}
            className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add concept map
          </button>
        </div>
        <p className="text-xs text-slate-500">
          The concepts this activity covers and what builds on what. Students see it as an orientation map;
          the tutor can run check questions per concept and light nodes up as they&apos;re demonstrated.
        </p>
      </div>
    );
  }

  const update = (patch: Partial<ConceptMapEditorValue>) => onChange({ ...value, ...patch });
  const updateNode = (key: number, patch: Partial<ConceptNodeRow>) =>
    update({ nodes: value.nodes.map((n) => (n.key === key ? { ...n, ...patch } : n)) });

  const addNode = () => {
    const k = nextKey();
    update({ nodes: [...value.nodes, { key: k, id: `node-${k}`, label: "", dependsOn: [], questions: [] }] });
  };
  const removeNode = (key: number) => {
    const removed = value.nodes.find((n) => n.key === key);
    update({
      nodes: value.nodes
        .filter((n) => n.key !== key)
        .map((n) => ({ ...n, dependsOn: n.dependsOn.filter((d) => d !== removed?.id) })),
    });
  };
  const toggleDep = (node: ConceptNodeRow, depId: string) =>
    updateNode(node.key, {
      dependsOn: node.dependsOn.includes(depId)
        ? node.dependsOn.filter((d) => d !== depId)
        : [...node.dependsOn, depId],
    });

  const labelled = value.nodes.filter((n) => n.label.trim());

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <MapIcon className="h-4 w-4 text-slate-500" /> Concept map
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-600"
        >
          Remove concept map
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">Title (optional)</span>
        <input
          type="text"
          value={value.title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="e.g. Projektilbevægelse"
          maxLength={120}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
      </label>

      <ul className="flex flex-col gap-3">
        {value.nodes.map((node, idx) => (
          <li key={node.key} className="flex flex-col gap-2 rounded-md border border-slate-100 bg-slate-50/60 p-2.5">
            <div className="flex items-center gap-2">
              <input
                type="text"
                aria-label={`Concept ${idx + 1}`}
                value={node.label}
                onChange={(e) => updateNode(node.key, { label: e.target.value })}
                placeholder="e.g. Vektorer"
                maxLength={120}
                className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={() => removeNode(node.key)}
                aria-label={`Remove concept ${idx + 1}`}
                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {labelled.some((c) => c.id !== node.id) && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-500">Builds on:</span>
                {labelled
                  .filter((c) => c.id !== node.id)
                  .map((c) => {
                    const active = node.dependsOn.includes(c.id);
                    const blocked = !active && wouldCreateCycle(value.nodes, node.id, c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={blocked}
                        title={blocked ? "Would create a cycle" : undefined}
                        onClick={() => toggleDep(node, c.id)}
                        className={`rounded-full border px-2 py-0.5 text-xs ${
                          active
                            ? "border-sky-400 bg-sky-50 font-medium text-sky-700"
                            : blocked
                              ? "cursor-not-allowed border-slate-200 text-slate-300"
                              : "border-slate-300 text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {c.label.trim()}
                      </button>
                    );
                  })}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              {node.questions.map((q, qIdx) => (
                <div key={q.key} className="flex items-start gap-2">
                  <div className="flex flex-1 flex-col gap-1">
                    <input
                      type="text"
                      aria-label={`Check question ${qIdx + 1} for concept ${idx + 1}`}
                      value={q.prompt}
                      onChange={(e) =>
                        updateNode(node.key, {
                          questions: node.questions.map((x) => (x.key === q.key ? { ...x, prompt: e.target.value } : x)),
                        })
                      }
                      placeholder="Check question — the tutor asks this in the chat"
                      maxLength={500}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    />
                    <input
                      type="text"
                      aria-label={`Expected answer ${qIdx + 1} for concept ${idx + 1}`}
                      value={q.expectedAnswer}
                      onChange={(e) =>
                        updateNode(node.key, {
                          questions: node.questions.map((x) =>
                            x.key === q.key ? { ...x, expectedAnswer: e.target.value } : x,
                          ),
                        })
                      }
                      placeholder="What a good answer covers (the tutor judges against this)"
                      maxLength={1000}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateNode(node.key, { questions: node.questions.filter((x) => x.key !== q.key) })
                    }
                    aria-label={`Remove check question ${qIdx + 1} for concept ${idx + 1}`}
                    className="mt-1 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {node.questions.length < 5 && (
                <button
                  type="button"
                  onClick={() =>
                    updateNode(node.key, {
                      questions: [...node.questions, { key: nextKey(), prompt: "", expectedAnswer: "" }],
                    })
                  }
                  className="self-start text-xs font-medium text-sky-700 hover:underline"
                >
                  + Check question
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {value.nodes.length < 30 && (
        <button
          type="button"
          onClick={addNode}
          className="flex items-center gap-1 self-start rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add concept
        </button>
      )}

      {labelled.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-slate-100 bg-white p-2">
          <ConceptMapGraph
            nodes={labelled.map((n) => ({ id: n.id, label: n.label.trim() }))}
            edges={labelled.flatMap((n) =>
              n.dependsOn
                .filter((d) => labelled.some((c) => c.id === d))
                .map((d) => ({ from: d, to: n.id })),
            )}
          />
        </div>
      )}
    </div>
  );
}
