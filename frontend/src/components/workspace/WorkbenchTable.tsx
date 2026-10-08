"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";
import { useSimSnapshotPush } from "@/hooks/useSimSnapshotPush";
import { useT } from "@/i18n";
import { parseCellNumber } from "@/lib/numbers";
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
 *  like WorkbenchChart can re-read the grid. `detail.storageKey` scopes it. */
export const TABLE_CHANGE_EVENT = "aipla:table-change";

/** sessionStorage key holding one activity's table cell values.
 *
 *  Scoped by ACTIVITY, not just skill. Every activity in a class runs on the same
 *  base skill, and teacher-authored element ids are minted from a per-builder
 *  counter (`table-k1`, `col-k3`, …), so two activities routinely share cell keys.
 *  Keyed by skill alone, a tab that moved from one activity to the next seeded
 *  the second activity's grid with the first one's readings and pushed them to
 *  that activity's tutor (prod, 2026-10-05: late-lynx-27's "Forsøg 2 = 72 cm" from
 *  *Den hoppende bold* arrived in *Faseovergange* as "Vandets starttemperatur =
 *  72 °C", with no commit of its own). A bare-skill mount (no activity) keeps the
 *  old key — there the skill IS the lesson. */
export function tableStorageKey(skillId: string, activityId?: string | null): string {
  return activityId ? `aipla.table:${skillId}:${activityId}` : `aipla.table:${skillId}`;
}

function cellKey(tableId: string, row: number, colId: string): string {
  return `${tableId}::${row}::${colId}`;
}

/** A numeric cell the chart cannot read (1.1.136). Empty is not "wrong" — it is
 *  just not filled yet. Decided by `parseCellNumber`, the same reader the chart
 *  uses, so the hint and the plot never disagree about what counts as a number. */
function isUnreadableNumber(raw: string | undefined): boolean {
  if (raw == null || raw.trim() === "") return false;
  return Number.isNaN(parseCellNumber(raw));
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
  const storageKey = tableStorageKey(skillId, activityId);
  const [values, setValues] = useState<Record<string, string>>({});
  // 1.1.88 — the group's store is the source of truth. `revisionRef` is the last
  // revision this client has seen; the store bumps it on every write, so a jump
  // is how we learn another group member typed something from another device.
  const t = useT("WorkbenchTable");
  const revisionRef = useRef(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // The cell being typed in. The not-a-number hint waits for the student to
  // leave the cell — "-" or "3e" mid-entry is not a mistake yet.
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
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
    humanToolEvents.dispatch({
      label: t("sharedCard", { title: p.title || t("untitled"), count: p.filled }),
      push: () => p.req,
    });
  }, [humanToolEvents, t]);

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
    const filled = snap.tables.reduce((n, t) => n + t.filledCells, 0);
    // 1.1.136 M0 — every per-cell push says what it was, with the SAME text the
    // debounced card will show. `logLabel`, not `label`: a card label here would
    // re-render one card per cell on transcript restore.
    const req = pushTableSnapshot(snap, kind, null, {
      logLabel: t("sharedCard", { title: cardTitle || t("untitled"), count: filled }),
      activityId,
    });
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
      window.dispatchEvent(new CustomEvent(TABLE_CHANGE_EVENT, { detail: { skillId, storageKey } }));
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
            window.dispatchEvent(new CustomEvent(TABLE_CHANGE_EVENT, { detail: { skillId, storageKey } }));
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
      const filled = snap.tables.reduce((n, g) => n + g.filledCells, 0);
      const req = pushTableSnapshot(snap, "table.sync", null, {
        logLabel: t("sharedCard", { title: snap.tables[0]?.title || t("untitled"), count: filled }),
        activityId,
      });
      if (req) void req.catch(() => {});
    }
    // Only on sessionId arrival — cell commits handle their own pushes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return (
    <div className="space-y-4 p-4">
      {tables.map((table) => {
        const hintId = `${table.id}-number-hint`;
        const showHint = table.columns.some(
          (col) =>
            col.kind !== "text" &&
            Array.from({ length: table.rows }).some((_, r) => {
              const key = cellKey(table.id, r, col.id);
              return key !== focusedKey && isUnreadableNumber(values[key]);
            }),
        );
        return (
        <section
          key={table.id}
          className="rounded-lg border border-border bg-card p-4 text-sm"
          aria-label={table.title || t("untitled")}
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
              {saveState === "saving" ? t("saving") : null}
              {saveState === "saved" ? t("saved") : null}
              {saveState === "error" ? t("saveError") : null}
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
                      // 1.1.136 — a numeric cell is a TEXT input with a decimal
                      // keypad, not type="number": most browsers hand the page ""
                      // for "3,42" in a number input, so a Danish reading was
                      // lost before any parser saw it. The value is stored EXACTLY
                      // as typed; only the chart parses it (parseCellNumber).
                      const numeric = col.kind !== "text";
                      const unreadable = numeric && key !== focusedKey && isUnreadableNumber(values[key]);
                      return (
                        <td key={col.id} className="border-b border-border/50 px-1 py-0.5">
                          <input
                            type="text"
                            inputMode={numeric ? "decimal" : "text"}
                            value={values[key] ?? ""}
                            onChange={(e) =>
                              setValues((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                            onFocus={() => setFocusedKey(key)}
                            onBlur={() => {
                              setFocusedKey((k) => (k === key ? null : k));
                              commit(table, key);
                            }}
                            aria-invalid={unreadable || undefined}
                            aria-describedby={unreadable ? hintId : undefined}
                            className={`w-full rounded border bg-transparent px-1 py-0.5 focus:border-primary focus:outline-none ${
                              unreadable ? "border-dashed border-amber-500/70" : "border-transparent"
                            }`}
                            aria-label={t("cellLabel", { table: table.title || t("untitledLower"), column: col.label, row: r + 1 })}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Soft, not a block: the reading is kept and shared as typed; the
              student is only told the chart will skip it. */}
          {showHint ? (
            <p id={hintId} className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              {t("notANumber")}
            </p>
          ) : null}
          <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
            {t("footer")}
          </p>
        </section>
        );
      })}
    </div>
  );
}
