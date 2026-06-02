/**
 * KpiCard — one cell of the per-class KPI grid.
 *
 * Axiom 2 — EARNED TRUST: every card carries (a) a one-line value,
 * (b) a definition tooltip that says exactly what's being counted,
 * (c) a "Show data" disclosure with the underlying SQL + params from
 * the M7 `_debug.queries` echo. No card hides its provenance.
 *
 * Pure presentation. No data fetching. The parent panel does the
 * fetch once and passes already-camelCased shapes in.
 */

"use client";

import { useState } from "react";
import { Info } from "lucide-react";

import type { InsightsQueryDebugEntry } from "@/lib/insightsApi";

interface KpiCardProps {
  label: string;
  value: string | number | null;
  unit?: string;
  /** One-sentence definition the tooltip surfaces. */
  definition: string;
  /** Underlying SQL + params, rendered inside the disclosure. */
  queries?: InsightsQueryDebugEntry[];
}

export function KpiCard({ label, value, unit, definition, queries }: KpiCardProps) {
  const [tipOpen, setTipOpen] = useState(false);
  const displayValue = value === null || value === undefined ? "—" : String(value);

  return (
    <article
      data-testid="kpi-card"
      data-label={label}
      className="flex flex-col gap-1 rounded border border-border bg-background p-3 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h3>
        <button
          type="button"
          aria-label={`Definition: ${definition}`}
          aria-expanded={tipOpen}
          onClick={() => setTipOpen((o) => !o)}
          className="text-muted-foreground hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <p className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums">{displayValue}</span>
        {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}
      </p>

      {tipOpen ? (
        <p data-testid="kpi-definition" className="rounded bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
          {definition}
        </p>
      ) : null}

      {queries && queries.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Show data</summary>
          <div className="mt-2 flex flex-col gap-2">
            {queries.map((q, i) => (
              <div key={`${q.name}-${i}`}>
                <p className="font-mono">{q.name}</p>
                {q.sql ? (
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted/60 p-1.5 text-[10px]">
                    {q.sql}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}
