"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";
import { useSimSnapshotPush } from "@/hooks/useSimSnapshotPush";

/** Coalesce the "shared with the tutor" card to one per editing burst — a cell
 *  blur fires as the student tabs through the grid, so a per-cell card would
 *  spam the chat. The PUSH still fires per cell; only the card is debounced. */
export const TABLE_CARD_DEBOUNCE_MS = 1200;

/**
 * One column of a teacher-defined data table (1.1.38 M1). Mirrors the backend
 * `TableColumn` (`backend/db/models/activity_config.py`).
 */
export interface TableColumnDef {
  id: string;
  label: string;
  unit?: string;
  kind?: "number" | "text";
}

/** A teacher-defined data table the student fills in. Mirrors `TableElement`. */
export interface TableElementDef {
  id: string;
  title?: string;
  columns: TableColumnDef[];
  rows: number;
}

interface WorkbenchTableProps {
  /** Skill id — scopes the sessionStorage key so activities don't share state. */
  skillId: string;
  /** The teacher-authored table definitions for this activity. */
  tables: TableElementDef[];
  /** Active chat session id. When set, a committed cell pushes the table
   * snapshot to /api/sessions/{id}/iframe-context so the tutor's next turn can
   * reference the entered values. When null the grid still works locally. */
  sessionId?: string | null;
}

interface TableSnapshot {
  tableId: string;
  title: string;
  columns: { id: string; label: string; unit: string }[];
  data: Record<string, string>[];
  filledCells: number;
}

/** Window event fired (same-document) after a table cell commits, so siblings
 *  like WorkbenchChart can re-read the grid. `detail.skillId` scopes it. */
export const TABLE_CHANGE_EVENT = "aipla:table-change";

/** sessionStorage key holding a skill's table cell values. */
export function tableStorageKey(skillId: string): string {
  return `aipla.table:${skillId}`;
}

function cellKey(tableId: string, row: number, colId: string): string {
  return `${tableId}::${row}::${colId}`;
}

/**
 * WorkbenchTable — student-fillable data table for a teacher-authored activity
 * (1.1.38 M1). The teacher defines columns + an empty row count; the student
 * enters readings and each committed cell pushes the whole table's grid to the
 * tutor via the existing `iframe-context` wire (the same path the checklist
 * uses), so the tutor can reference "your third trial gives v = 2.1 m/s".
 *
 * Pedagogical principle (shared with ProgressChecklist): student-driven. The
 * grid IS the student's feedback. A per-cell chat card would spam the
 * conversation, so the "shared with the tutor" card is DEBOUNCED to one per
 * editing burst (the push itself still fires per cell). Ground-truth checking of
 * the entered values is the offline-lab (1.1.24) extension, NOT done here.
 */
export function WorkbenchTable({ skillId, tables, sessionId }: WorkbenchTableProps) {
  const storageKey = tableStorageKey(skillId);
  const [values, setValues] = useState<Record<string, string>>({});
  // Last-pushed value per cell — a blur with no change is a no-op (no duplicate
  // iframe-context push).
  const committedRef = useRef<Record<string, string>>({});
  const pushTableSnapshot = useSimSnapshotPush<TableSnapshot>(sessionId ?? null, "table");
  const humanToolEvents = useHumanToolEvents();
  // Debounced trust card: the latest committed push + its filled-count, flushed
  // once the student stops editing for TABLE_CARD_DEBOUNCE_MS.
  const cardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCard = useRef<{ req: Promise<Response>; filled: number; title: string } | null>(null);

  const flushTableCard = useCallback(() => {
    const p = pendingCard.current;
    pendingCard.current = null;
    cardTimer.current = null;
    if (!p || p.filled === 0) return; // nothing entered → no card
    const unit = p.filled === 1 ? "felt" : "felter";
    humanToolEvents.dispatch({
      label: `${p.title || "Datatabel"} delt med vejlederen (${p.filled} ${unit})`,
      push: () => p.req,
    });
  }, [humanToolEvents]);

  // Clear any pending card timer on unmount (avoids a dispatch after teardown).
  useEffect(() => () => {
    if (cardTimer.current) clearTimeout(cardTimer.current);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        setValues(parsed as Record<string, string>);
        committedRef.current = { ...(parsed as Record<string, string>) };
      }
    } catch {
      // Stale/garbage data — ignore. New writes overwrite.
    }
  }, [storageKey]);

  const buildSnapshot = (table: TableElementDef, vals: Record<string, string>): TableSnapshot => {
    const data: Record<string, string>[] = [];
    let filled = 0;
    for (let r = 0; r < table.rows; r++) {
      const row: Record<string, string> = {};
      for (const col of table.columns) {
        const v = vals[cellKey(table.id, r, col.id)] ?? "";
        row[col.id] = v;
        if (v.trim() !== "") filled++;
      }
      data.push(row);
    }
    return {
      tableId: table.id,
      title: table.title ?? "",
      columns: table.columns.map((c) => ({ id: c.id, label: c.label, unit: c.unit ?? "" })),
      data,
      filledCells: filled,
    };
  };

  // Commit a cell on blur: persist + push the table snapshot. Silent — the grid
  // is the feedback. Kind "table.commit" doesn't map to a proactive trigger, so
  // entering data makes it available to the tutor's next turn without firing an
  // unprompted tutor reply.
  const commit = (table: TableElementDef, key: string) => {
    const current = values[key] ?? "";
    if ((committedRef.current[key] ?? "") === current) return;
    committedRef.current[key] = current;
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(storageKey, JSON.stringify(values));
      // Let a sibling chart (1.1.38 M2) re-read the grid.
      window.dispatchEvent(new CustomEvent(TABLE_CHANGE_EVENT, { detail: { skillId } }));
    }
    const snap = buildSnapshot(table, values);
    const req = pushTableSnapshot(snap, "table.commit");
    if (req) {
      void req.catch((err) => {
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn("[table] iframe-context push failed:", err);
        }
      });
      // Coalesce a single "shared with the tutor" card per editing burst — the
      // card rides this push but only flushes once edits settle (see
      // TABLE_CARD_DEBOUNCE_MS). Mirrors the calculator/checklist trust bit
      // without a card per cell.
      pendingCard.current = { req, filled: snap.filledCells, title: snap.title };
      if (cardTimer.current) clearTimeout(cardTimer.current);
      cardTimer.current = setTimeout(flushTableCard, TABLE_CARD_DEBOUNCE_MS);
    }
  };

  // Catch-up push when sessionId arrives: students often fill the grid before
  // the first chat turn (sessionId null → push short-circuits). On session
  // creation, push any table that already has data so the tutor sees it.
  useEffect(() => {
    if (!sessionId) return;
    for (const table of tables) {
      const snap = buildSnapshot(table, values);
      if (snap.filledCells > 0) {
        const req = pushTableSnapshot(snap, "table.sync");
        if (req) void req.catch(() => {});
      }
    }
    // Only on sessionId arrival — cell commits handle their own pushes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return (
    <div className="space-y-4 p-4">
      {tables.map((table) => (
        <section
          key={table.id}
          className="rounded-lg border border-border bg-card p-4 text-sm"
          aria-label={table.title || "Datatabel"}
        >
          {table.title && (
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {table.title}
            </h3>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {table.columns.map((col) => (
                    <th
                      key={col.id}
                      className="border-b border-border px-2 py-1 text-left text-xs font-medium text-muted-foreground"
                    >
                      {col.label}
                      {col.unit ? <span className="ml-1 text-muted-foreground/70">({col.unit})</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: table.rows }).map((_, r) => (
                  <tr key={r}>
                    {table.columns.map((col) => {
                      const key = cellKey(table.id, r, col.id);
                      return (
                        <td key={col.id} className="border-b border-border/50 px-1 py-0.5">
                          <input
                            type={col.kind === "text" ? "text" : "number"}
                            inputMode={col.kind === "text" ? "text" : "decimal"}
                            value={values[key] ?? ""}
                            onChange={(e) =>
                              setValues((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                            onBlur={() => commit(table, key)}
                            className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 focus:border-primary focus:outline-none"
                            aria-label={`${table.title || "tabel"} ${col.label} række ${r + 1}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
            Indtast dine målinger — de deles med vejlederen, så du kan spørge til dem.
          </p>
        </section>
      ))}
    </div>
  );
}
