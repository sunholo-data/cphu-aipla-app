"use client";

import { Plus, Table as TableIcon, X } from "lucide-react";

/** One column being authored.
 *
 *  `key` is a stable client id for React. `id` is the PERSISTED `TableColumn.id`
 *  and is set only when this column came from a saved activity — 1.1.71 mints
 *  ids at creation and preserves saved ones on load, instead of recomputing them
 *  positionally on every save (which is how deleting a column used to re-point a
 *  chart at a different variable). */
export interface TableEditorColumn {
  key: number;
  /** Preserved from the saved activity; absent for a column added in this session. */
  id?: string;
  label: string;
  unit: string;
  kind: "number" | "text";
}

/** One data table being authored (1.1.71 — the builder holds a LIST of these).
 *
 *  Same `key`/`id` split as the columns, and for the same reason: deleting the
 *  first of three tables must not rename the second from `table-2` to `table-1`
 *  and silently re-point every chart bound to it. */
export interface TableEditorValue {
  key: number;
  /** Preserved from the saved activity; absent for a table added in this session. */
  id?: string;
  title: string;
  columns: TableEditorColumn[];
  rows: number;
}

interface TableEditorProps {
  value: TableEditorValue[];
  onChange: (value: TableEditorValue[]) => void;
  /** Key minter owned by the builder, shared across element kinds (the same
   *  `nextKey` idiom WritingEditor and ConceptMapEditor already take). Keys must
   *  come from one counter, because they are what new element ids are minted
   *  from and two counters would eventually mint the same id. */
  nextKey: () => number;
}

const MAX_COLUMNS = 8;
const MAX_ROWS = 50;
/** Mirrors `ELEMENT_REGISTRY["table"].max_items` on the backend, which has
 *  allowed five since 1.1.38 — the builder was the constraint, not the model. */
export const MAX_TABLES = 5;

/** A human label for one table, for aria-labels and the chart picker. Falls back
 *  to its position, because an untitled table still has to be distinguishable —
 *  "Data table" three times over is the state this feature exists to leave. */
export function tableLabel(table: TableEditorValue, index: number): string {
  return table.title.trim() || `Table ${index + 1}`;
}

function newColumn(nextKey: () => number): TableEditorColumn {
  return { key: nextKey(), label: "", unit: "", kind: "number" };
}

function newTable(nextKey: () => number): TableEditorValue {
  return { key: nextKey(), title: "", columns: [newColumn(nextKey)], rows: 5 };
}

/**
 * TableEditor — the teacher-builder editor for data-table elements (1.1.38 M1,
 * multi-table since 1.1.71). The teacher defines columns (label + unit +
 * number/text) and a row count; the student gets that many empty rows to fill in
 * the activity workspace.
 *
 * Up to `MAX_TABLES` tables — "sometimes we need multiple tables in physics lab"
 * (Aswin, 2026-08-10). An empty list means "no table" (the activity stays
 * chat-only / checklist-only). The parent drops unlabelled columns and
 * column-less tables on save; columns 1-8 / rows 1-50 are enforced here and
 * re-validated server-side.
 *
 * Ids are NOT assigned here — `tableDefs` mints them from `key` for new elements
 * and preserves `id` for loaded ones, so nothing an author does renames anything.
 */
export function TableEditor({ value, onChange, nextKey }: TableEditorProps) {
  const tables = value ?? [];
  const atCap = tables.length >= MAX_TABLES;

  const updateTable = (key: number, patch: Partial<TableEditorValue>) =>
    onChange(tables.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const removeTable = (key: number) => onChange(tables.filter((t) => t.key !== key));
  const addTable = () => onChange([...tables, newTable(nextKey)]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <TableIcon className="h-4 w-4 text-slate-500" />
          Data tables{" "}
          {tables.length > 0 && (
            <span className="text-xs text-slate-500">
              ({tables.length}/{MAX_TABLES})
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={addTable}
          disabled={atCap}
          // The cap is stated, not just enforced: a disabled button with no
          // reason reads as a bug rather than a limit.
          title={atCap ? `Maximum ${MAX_TABLES} tables per activity` : undefined}
          className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> Add data table
        </button>
      </div>

      {tables.length === 0 ? (
        <p className="text-xs text-slate-500">
          A grid the student fills in (e.g. trial · time · velocity). Entered values are shared with the
          tutor so the student can ask about their own measurements.
        </p>
      ) : (
        <>
          {atCap && (
            <p className="text-xs text-slate-500">
              Maximum {MAX_TABLES} tables per activity.
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {tables.map((table, tIdx) => {
              const label = tableLabel(table, tIdx);
              const setColumn = (colKey: number, patch: Partial<TableEditorColumn>) =>
                updateTable(table.key, {
                  columns: table.columns.map((c) => (c.key === colKey ? { ...c, ...patch } : c)),
                });
              const removeColumn = (colKey: number) =>
                updateTable(table.key, { columns: table.columns.filter((c) => c.key !== colKey) });
              const addColumn = () =>
                updateTable(table.key, { columns: [...table.columns, newColumn(nextKey)] });

              return (
                <li key={table.key} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                      <TableIcon className="h-4 w-4 text-slate-500" /> {label}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeTable(table.key)}
                      aria-label={`Remove ${label}`}
                      className="rounded px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      Remove table
                    </button>
                  </div>

                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">Title (optional)</span>
                    <input
                      type="text"
                      aria-label={`${label} title`}
                      value={table.title}
                      onChange={(e) => updateTable(table.key, { title: e.target.value })}
                      placeholder="e.g. Målinger"
                      maxLength={120}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    />
                  </label>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-600">Columns</span>
                      <button
                        type="button"
                        onClick={addColumn}
                        disabled={table.columns.length >= MAX_COLUMNS}
                        aria-label={`Add column to ${label}`}
                        title={
                          table.columns.length >= MAX_COLUMNS
                            ? `Maximum ${MAX_COLUMNS} columns per table`
                            : undefined
                        }
                        className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add column
                      </button>
                    </div>
                    {table.columns.length === 0 ? (
                      <p className="rounded border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">
                        Add at least one column — a table with no columns won&apos;t be saved.
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {table.columns.map((col, idx) => (
                          <li key={col.key} className="flex items-center gap-2">
                            <input
                              type="text"
                              aria-label={`${label} column ${idx + 1} label`}
                              value={col.label}
                              onChange={(e) => setColumn(col.key, { label: e.target.value })}
                              placeholder="Label (e.g. Tid)"
                              maxLength={80}
                              className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                            />
                            <input
                              type="text"
                              aria-label={`${label} column ${idx + 1} unit`}
                              value={col.unit}
                              onChange={(e) => setColumn(col.key, { unit: e.target.value })}
                              placeholder="Unit"
                              maxLength={24}
                              className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                            />
                            <select
                              aria-label={`${label} column ${idx + 1} type`}
                              value={col.kind}
                              onChange={(e) =>
                                setColumn(col.key, { kind: e.target.value as "number" | "text" })
                              }
                              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                            >
                              <option value="number">Number</option>
                              <option value="text">Text</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => removeColumn(col.key)}
                              aria-label={`Remove ${label} column ${idx + 1}`}
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">
                      Empty rows for the student to fill
                    </span>
                    <input
                      type="number"
                      aria-label={`${label} row count`}
                      min={1}
                      max={MAX_ROWS}
                      value={table.rows}
                      onChange={(e) =>
                        updateTable(table.key, {
                          rows: Math.max(1, Math.min(MAX_ROWS, Number(e.target.value) || 1)),
                        })
                      }
                      className="w-24 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
