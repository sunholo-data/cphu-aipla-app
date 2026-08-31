"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";
import { useSimSnapshotPush } from "@/hooks/useSimSnapshotPush";
import { fetchTable, saveTableCells } from "@/lib/tableApi";
import type { TableColumn, TableElement } from "@/lib/elementTypes";

/** Coalesce the "shared with the tutor" card to one per editing burst — a cell
 *  blur fires as the student tabs through the grid, so a per-cell card would
 *  spam the chat. The PUSH still fires per cell; only the card is debounced. */
export const TABLE_CARD_DEBOUNCE_MS = 1200;

// `*Def` are the canonical lib/elementTypes definitions, re-exported under the
// historical render-side names so existing imports keep working.
export type TableColumnDef = TableColumn;
export type TableElementDef = TableElement;

interface WorkbenchTableProps {
  /** Skill id — scopes the sessionStorage OFFLINE BUFFER so activities don't
   *  share state. No longer the source of truth (1.1.88). */
  skillId: string;
  /** Activity id — the key of the per-group `table_progress` store, which IS the
   *  source of truth (1.1.88). Absent (activity preview, a legacy mount) the grid
   *  degrades to the old per-tab behaviour rather than refusing to work. */
  activityId?: string;
  /** The teacher-authored table definitions for this activity. */
  tables: TableElementDef[];
  /** Active chat session id. When set, a committed cell pushes the table
   * snapshot to /api/sessions/{id}/iframe-context so the tutor's next turn can
   * reference the entered values. When null the grid still works locally. */
  sessionId?: string | null;
}

/** One table's grid, as the tutor sees it. */
interface TableGrid {
  tableId: string;
  title: string;
  columns: { id: string; label: string; unit: string }[];
  data: Record<string, string>[];
  filledCells: number;
}

/** What the tutor receives (`mcp_app_context.table.state`).
 *
 *  Calculator- and writing-shaped (1.1.88 M2 / 1.1.71): EVERY table on the
 *  activity in one array, matched by id. It used to be a single `TableGrid`, so
 *  all tables shared one slot and any table the student was not currently
 *  editing reported EMPTY — `element_state.py` said so in as many words. The
 *  backend reader accepts both shapes so sessions live at deploy time keep
 *  working; new pushes are always the array. */
interface TableSnapshot {
  tables: TableGrid[];
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
export function WorkbenchTable({ skillId, tables, sessionId, activityId }: WorkbenchTableProps) {
  const storageKey = tableStorageKey(skillId);
  const [values, setValues] = useState<Record<string, string>>({});
  // 1.1.88 — the group's store is the source of truth. `revisionRef` is the last
  // revision this client has seen; the store bumps it on every write, so a jump
  // is how we learn another group member typed something from another device.
  const revisionRef = useRef(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
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

  // Seed from the sessionStorage OFFLINE BUFFER first so the grid is never blank
  // while the store is in flight — then the store's answer replaces it. The
  // buffer is a cache of this tab's own last view, not the truth: it cannot
  // contain another group member's readings, which is the whole defect.
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

  // Load the GROUP's grid. This is what makes two students one table: everything
  // any member has entered, including from a device this student has never seen,
  // and including everything typed before this tab was opened.
  useEffect(() => {
    if (!activityId) return;
    let cancelled = false;
    void fetchTable(activityId).then((state) => {
      if (cancelled) return;
      revisionRef.current = state.revision;
      if (Object.keys(state.cells).length === 0) return;
      setValues((local) => {
        // The store wins on every cell it knows about; anything this tab has
        // that the store does not is an unsaved local edit and is kept, so a
        // load landing mid-typing never eats a reading.
        const merged = { ...local, ...state.cells };
        committedRef.current = { ...committedRef.current, ...state.cells };
        return merged;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [activityId]);

  const buildGrid = (table: TableElementDef, vals: Record<string, string>): TableGrid => {
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

  /** EVERY table on the activity, so a second table is never reported EMPTY
   *  just because the student is currently editing the first (1.1.71). */
  const buildSnapshot = (vals: Record<string, string>): TableSnapshot => ({
    tables: tables.map((t) => buildGrid(t, vals)),
  });

  // Commit a cell on blur: persist + push the table snapshot. Silent — the grid
  // is the feedback. Kind "table.commit" doesn't map to a proactive trigger, so
  // entering data makes it available to the tutor's next turn without firing an
  // unprompted tutor reply.
  /** Push the whole activity's grids to the tutor and ride a trust card on it. */
  const pushAndCard = (vals: Record<string, string>, kind: string, cardTitle: string) => {
    const snap = buildSnapshot(vals);
    const req = pushTableSnapshot(snap, kind);
    if (!req) return;
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
    const filled = snap.tables.reduce((n, t) => n + t.filledCells, 0);
    pendingCard.current = { req, filled, title: cardTitle };
    if (cardTimer.current) clearTimeout(cardTimer.current);
    cardTimer.current = setTimeout(flushTableCard, TABLE_CARD_DEBOUNCE_MS);
  };

  const commit = (table: TableElementDef, key: string) => {
    const current = values[key] ?? "";
    if ((committedRef.current[key] ?? "") === current) return;
    committedRef.current[key] = current;
    if (typeof window !== "undefined") {
      // Offline buffer, not the truth (1.1.88) — kept so the grid survives a
      // reload while the store is unreachable, and so WorkbenchChart's existing
      // read path is untouched.
      window.sessionStorage.setItem(storageKey, JSON.stringify(values));
      // Let a sibling chart (1.1.38 M2) re-read the grid.
      window.dispatchEvent(new CustomEvent(TABLE_CHANGE_EVENT, { detail: { skillId } }));
    }

    if (!activityId) {
      // No store to save to (preview / legacy mount): the pre-1.1.88 behaviour,
      // rather than dropping the reading on the floor.
      pushAndCard(values, "table.commit", table.title ?? "");
      return;
    }

    // Send ONLY the changed cell. The merge happens server-side, so a group
    // member filling another row at the same moment is not overwritten by this
    // client's older copy of their value.
    setSaveState("saving");
    void saveTableCells(activityId, { [key]: current })
      .then((state) => {
        revisionRef.current = state.revision;
        setSaveState("saved");
        // The response is the WHOLE group's grid. Adopt it — that is the moment
        // this student first sees their partner's readings — and push THAT to
        // the tutor, which is the other half of the report ("the AI only saw the
        // most recently entered values").
        setValues((local) => {
          const merged = { ...local, ...state.cells };
          committedRef.current = { ...committedRef.current, ...state.cells };
          if (typeof window !== "undefined") {
            window.sessionStorage.setItem(storageKey, JSON.stringify(merged));
            window.dispatchEvent(new CustomEvent(TABLE_CHANGE_EVENT, { detail: { skillId } }));
          }
          pushAndCard(merged, "table.commit", table.title ?? "");
          return merged;
        });
      })
      .catch(() => {
        // Visible, not silent (Axiom 5): the student is told the reading is not
        // shared. The cell keeps its value and the buffer keeps it across a
        // reload; the next commit retries the save.
        setSaveState("error");
        pushAndCard(values, "table.commit", table.title ?? "");
      });
  };

  // Catch-up push when sessionId arrives: students often fill the grid before
  // the first chat turn (sessionId null → push short-circuits). On session
  // creation, push any table that already has data so the tutor sees it.
  useEffect(() => {
    if (!sessionId) return;
    const snap = buildSnapshot(values);
    if (snap.tables.some((t) => t.filledCells > 0)) {
      const req = pushTableSnapshot(snap, "table.sync");
      if (req) void req.catch(() => {});
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
          <div className="mb-2 flex items-baseline justify-between gap-2">
            {table.title ? (
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{table.title}</h3>
            ) : (
              <span />
            )}
            {/* 1.1.88 — a failed save must be VISIBLE. The old grid wrote to
                sessionStorage, which cannot fail, so there was nothing to show;
                now the reading has to reach the group and the student is the
                only one who can tell us it did not. Same copy as the writing
                element, because it is the same promise. */}
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {saveState === "saving" ? "Gemmer…" : null}
              {saveState === "saved" ? "Gemt for gruppen" : null}
              {saveState === "error" ? "Ikke gemt — prøver igen" : null}
            </span>
          </div>
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
