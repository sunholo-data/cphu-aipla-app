"use client";

// ConceptMapGraph — the shared auto-layout SVG rendering of a concept map
// (living-concept-map M0/M1). One renderer for BOTH the teacher's builder
// preview and the student's read-only view, so the two can't drift. Layout is
// deterministic topological layering (no drag-editing — the list editor is the
// authoring surface; graph-mode editing is deferred by design). The map data is
// cycle-guarded server-side (Kahn), so the layering below always terminates.

export type ConceptNodeStatus = "not_yet" | "partial" | "demonstrated";

export interface ConceptGraphNode {
  id: string;
  label: string;
}

export interface ConceptGraphEdge {
  from: string;
  to: string;
}

/** How a CLASS stands on one concept (CONCEPT-2 M5) — how many of its groups
 *  are where. `notSeen` is groups with no record at all, which is a different
 *  fact from `not_yet` and is never merged into it. */
export interface ConceptGroupSpread {
  demonstrated: number;
  partial: number;
  not_yet: number;
  notSeen: number;
}

const NODE_W = 150;
const NODE_H = 44;
/** The spread bar sits inside the node's own height, under the label. */
const BAR_H = 6;
const COL_GAP = 60;
const ROW_GAP = 20;
const PAD = 16;

const STATUS_STYLE: Record<ConceptNodeStatus, { rect: string; text: string }> = {
  not_yet: { rect: "fill-white stroke-slate-300", text: "fill-slate-700" },
  partial: { rect: "fill-amber-50 stroke-amber-400", text: "fill-amber-900" },
  demonstrated: { rect: "fill-emerald-50 stroke-emerald-500", text: "fill-emerald-900" },
};

/** Longest-path topological layer per node: 0 for roots, else 1 + max(prereq
 *  layers). Nodes on a cyclic remainder (can't happen for server-validated
 *  maps, but the editor renders drafts) fall back to layer 0. */
export function conceptLayers(nodes: ConceptGraphNode[], edges: ConceptGraphEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const layers = new Map<string, number>();
  const valid = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  // Relaxation passes — n nodes bounds the longest path, so n passes suffice.
  for (const n of nodes) layers.set(n.id, 0);
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const e of valid) {
      const want = (layers.get(e.from) ?? 0) + 1;
      if (want > (layers.get(e.to) ?? 0) && want < nodes.length + 1) {
        layers.set(e.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layers;
}

/** The spread bar's segments, weakest first, in the same colours the single
 *  statuses use — so a class node and a group node read as the same vocabulary.
 *  `notSeen` is slate: absent, not failed. */
const SPREAD_SEGMENTS: { key: keyof ConceptGroupSpread; fill: string }[] = [
  { key: "demonstrated", fill: "fill-emerald-500" },
  { key: "partial", fill: "fill-amber-400" },
  { key: "not_yet", fill: "fill-slate-400" },
  { key: "notSeen", fill: "fill-slate-200" },
];

function truncate(label: string, max = 20): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/**
 * Pure SVG — scrolls inside the caller's `overflow-x-auto` container (~700px
 * student viewport, Axiom 11); never scales text down to fit.
 */
export function ConceptMapGraph({
  nodes,
  edges,
  nodeStates,
  nodeSpread,
  onSelect,
  selectedId,
}: {
  nodes: ConceptGraphNode[];
  edges: ConceptGraphEdge[];
  nodeStates?: Record<string, ConceptNodeStatus>;
  /** CONCEPT-2 M5 — class view. A node given a spread renders NEUTRAL with a
   *  proportional bar rather than one status colour: a class where three groups
   *  have a concept and three have not is the interesting node, and colouring
   *  it by a single winner is exactly the averaging-away the distribution
   *  exists to prevent. */
  nodeSpread?: Record<string, ConceptGroupSpread>;
  /** Makes nodes clickable (the class view's detail panel). */
  onSelect?: (id: string) => void;
  selectedId?: string | null;
}) {
  if (nodes.length === 0) return null;

  const layers = conceptLayers(nodes, edges);
  const byLayer = new Map<number, ConceptGraphNode[]>();
  for (const n of nodes) {
    const l = layers.get(n.id) ?? 0;
    byLayer.set(l, [...(byLayer.get(l) ?? []), n]);
  }
  const maxLayer = Math.max(...byLayer.keys());
  const maxRows = Math.max(...[...byLayer.values()].map((g) => g.length));

  const pos = new Map<string, { x: number; y: number }>();
  for (const [layer, group] of byLayer) {
    group.forEach((n, row) => {
      pos.set(n.id, {
        x: PAD + layer * (NODE_W + COL_GAP),
        y: PAD + row * (NODE_H + ROW_GAP),
      });
    });
  }

  const width = PAD * 2 + (maxLayer + 1) * NODE_W + maxLayer * COL_GAP;
  const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP;
  const ids = new Set(nodes.map((n) => n.id));

  return (
    <svg
      role="img"
      aria-label="Begrebskort"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="max-w-none"
    >
      <defs>
        <marker id="concept-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" className="fill-slate-400" />
        </marker>
      </defs>
      {edges
        .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
        .map((e) => {
          const a = pos.get(e.from)!;
          const b = pos.get(e.to)!;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={`${e.from}->${e.to}`}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2 - 3} ${y2}`}
              className="fill-none stroke-slate-400"
              strokeWidth={1.5}
              markerEnd="url(#concept-arrow)"
            />
          );
        })}
      {nodes.map((n) => {
        const p = pos.get(n.id)!;
        const spread = nodeSpread?.[n.id];
        const style = spread
          ? { rect: "fill-white stroke-slate-300", text: "fill-slate-800" }
          : STATUS_STYLE[nodeStates?.[n.id] ?? "not_yet"];
        const total = spread ? SPREAD_SEGMENTS.reduce((sum, seg) => sum + spread[seg.key], 0) : 0;
        let offset = 0;
        return (
          <g
            key={n.id}
            data-testid={`concept-node-${n.id}`}
            data-status={nodeStates?.[n.id] ?? "not_yet"}
            onClick={onSelect ? () => onSelect(n.id) : undefined}
            className={onSelect ? "cursor-pointer" : undefined}
          >
            <rect
              x={p.x}
              y={p.y}
              width={NODE_W}
              height={NODE_H}
              rx={8}
              strokeWidth={selectedId === n.id ? 3 : 1.5}
              className={selectedId === n.id ? "fill-sky-50 stroke-sky-500" : style.rect}
            />
            <text
              x={p.x + NODE_W / 2}
              y={p.y + (spread ? NODE_H / 2 : NODE_H / 2 + 4)}
              textAnchor="middle"
              className={`text-[12px] font-medium ${style.text}`}
            >
              {truncate(n.label)}
              <title>{n.label}</title>
            </text>
            {spread && total > 0
              ? SPREAD_SEGMENTS.map((seg) => {
                  const w = (spread[seg.key] / total) * (NODE_W - 20);
                  const x = p.x + 10 + offset;
                  offset += w;
                  return w > 0 ? (
                    <rect
                      key={seg.key}
                      data-testid={`spread-${n.id}-${seg.key}`}
                      x={x}
                      y={p.y + NODE_H - BAR_H - 6}
                      width={w}
                      height={BAR_H}
                      rx={2}
                      className={seg.fill}
                    />
                  ) : null;
                })
              : null}
          </g>
        );
      })}
    </svg>
  );
}
