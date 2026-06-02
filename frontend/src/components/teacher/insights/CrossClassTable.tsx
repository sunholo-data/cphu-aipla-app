/**
 * Sortable cross-class comparison table for /teacher/insights.
 *
 * Pure-presentation component — receives the row array as a prop and
 * sorts client-side. Wider screens get all columns; narrow screens
 * scroll horizontally. Click a column header to sort (toggles asc/desc
 * on repeat click). Click a row to deep-link into the class page.
 *
 * Recharts is intentionally NOT used here — a sortable table is a
 * better cognitive fit for the "how does this class compare to my
 * others?" question than another chart (axiom 11). The per-class
 * trend sparkline lives on M9's KPI strip.
 */

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import type { InsightsCompareRow } from "@/lib/insightsApi";

type SortKey = "name" | "activeGroups" | "messages" | "messagesDelta" | "simRuns" | "lastActivity";
type Direction = "asc" | "desc";

interface CrossClassTableProps {
  rows: InsightsCompareRow[];
  /** Default column to sort by on first render. */
  defaultSort?: SortKey;
}

interface ColumnDef {
  key: SortKey;
  label: string;
  numeric: boolean;
  /** Optional override of the rendered cell — falls back to `String(row[key])`. */
  render?: (row: InsightsCompareRow) => React.ReactNode;
  /** Optional override of the sort value (e.g. timestamps as Date.parse). */
  sortValue?: (row: InsightsCompareRow) => string | number;
}

const COLUMNS: ColumnDef[] = [
  { key: "name", label: "Class", numeric: false },
  { key: "activeGroups", label: "Groups", numeric: true },
  { key: "messages", label: "Messages 7d", numeric: true },
  {
    key: "messagesDelta",
    label: "Δ vs prior",
    numeric: true,
    render: (r) => formatDelta(r.messagesDelta),
  },
  { key: "simRuns", label: "Sim runs", numeric: true },
  {
    key: "lastActivity",
    label: "Last activity",
    numeric: false,
    render: (r) => formatRelative(r.lastActivity),
    sortValue: (r) => (r.lastActivity ? Date.parse(r.lastActivity) : 0),
  },
];

export function CrossClassTable({ rows, defaultSort = "messages" }: CrossClassTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>(defaultSort);
  const [direction, setDirection] = useState<Direction>("desc");

  const sortedRows = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey);
    const get = col?.sortValue ?? ((r: InsightsCompareRow) => r[sortKey] as string | number);
    const dirFactor = direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dirFactor;
      return String(av).localeCompare(String(bv)) * dirFactor;
    });
  }, [rows, sortKey, direction]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // First click on a new column: default to descending for numeric
      // (most engagement first), ascending for text (A-Z).
      const col = COLUMNS.find((c) => c.key === key);
      setDirection(col?.numeric ? "desc" : "asc");
    }
  };

  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground" data-testid="cross-class-empty">
        No classes to compare yet. Create a class on the dashboard first.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-border" data-testid="cross-class-table">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`whitespace-nowrap px-3 py-2 text-left font-medium ${col.numeric ? "text-right" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => onSort(col.key)}
                  aria-label={`Sort by ${col.label}`}
                  className="inline-flex items-center gap-1 text-xs uppercase tracking-wide hover:text-foreground"
                >
                  {col.label}
                  <SortIndicator active={sortKey === col.key} direction={direction} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={row.classId} className="border-t border-border hover:bg-muted/40">
              {COLUMNS.map((col) => (
                <td
                  key={col.key}
                  className={`whitespace-nowrap px-3 py-2 ${col.numeric ? "text-right tabular-nums" : ""}`}
                >
                  {col.key === "name" ? (
                    <Link href={`/teacher/classes/${row.classId}`} className="font-medium hover:underline">
                      {row.name}
                    </Link>
                  ) : col.render ? (
                    col.render(row)
                  ) : (
                    String(row[col.key as keyof InsightsCompareRow])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortIndicator({ active, direction }: { active: boolean; direction: Direction }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />;
  return direction === "asc" ? (
    <ArrowUp className="h-3 w-3" aria-hidden="true" />
  ) : (
    <ArrowDown className="h-3 w-3" aria-hidden="true" />
  );
}

function formatDelta(delta: number): React.ReactNode {
  if (delta === 0) return <span className="text-muted-foreground">0</span>;
  const sign = delta > 0 ? "+" : "";
  const colour = delta > 0 ? "text-emerald-700" : "text-rose-700";
  return <span className={colour}>{`${sign}${delta}`}</span>;
}

function formatRelative(iso: string | null): React.ReactNode {
  if (!iso) return <span className="text-muted-foreground">—</span>;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return <span className="text-muted-foreground">—</span>;
  const diffMin = Math.round((Date.now() - t) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)} h ago`;
  return `${Math.round(diffMin / 60 / 24)} d ago`;
}
