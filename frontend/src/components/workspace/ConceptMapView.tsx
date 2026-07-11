"use client";

// ConceptMapView — the student's read-only living concept map
// (living-concept-map M1). Orientation, NOT a grade: nodes light up as the
// tutor's chat-native checkpoints mark them demonstrated (M3 wires the state
// fetch; until then every node renders not_yet). The map never becomes a quiz
// UI — assessment happens in the conversation (M, 2026-07-10).

import { Map as MapIcon } from "lucide-react";

import type { ConceptMapElement } from "@/lib/elementTypes";

import { ConceptMapGraph, type ConceptNodeStatus } from "./ConceptMapGraph";

/** Render-shape alias, following the `*Def` convention of the other elements
 *  (the canonical wire type lives in `lib/elementTypes.ts`). */
export type ConceptMapElementDef = ConceptMapElement;

const LEGEND: { status: ConceptNodeStatus; label: string; dot: string }[] = [
  { status: "not_yet", label: "ikke endnu", dot: "border-slate-300 bg-white" },
  { status: "partial", label: "på vej", dot: "border-amber-400 bg-amber-50" },
  { status: "demonstrated", label: "forstået", dot: "border-emerald-500 bg-emerald-50" },
];

export function ConceptMapView({
  conceptMap,
  nodeStates,
}: {
  conceptMap: ConceptMapElementDef[];
  /** node id → checkpoint status; absent = all not_yet (pre-M3 / fresh session). */
  nodeStates?: Record<string, ConceptNodeStatus>;
}) {
  const map = conceptMap[0];
  if (!map || map.nodes.length === 0) return null;

  return (
    <div className="space-y-3 p-4" data-testid="concept-map-view">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <MapIcon className="h-4 w-4 text-slate-500" />
        {map.title?.trim() || "Begrebskort"}
      </h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-2">
        <ConceptMapGraph nodes={map.nodes} edges={map.edges} nodeStates={nodeStates} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        {LEGEND.map((l) => (
          <span key={l.status} className="flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded-full border ${l.dot}`} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
