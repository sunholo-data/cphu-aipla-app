"use client";

import { Plus, Table as TableIcon, X } from "lucide-react";
import { useRef } from "react";

/** One column being authored. `key` is a stable client id for React; the
 *  persisted `TableColumn.id` is assigned positionally on save. */
export interface TableEditorColumn {
  key: number;
  label: string;
  unit: string;
  kind: "number" | "text";
}

export interface TableEditorValue {
  title: string;
  columns: TableEditorColumn[];
  rows: number;
}

interface TableEditorProps {
  value: TableEditorValue | null;
  onChange: (value: TableEditorValue | null) => void;
}

const MAX_COLUMNS = 8;
const MAX_ROWS = 50;

/**
 * TableEditor — the teacher-builder editor for a data-table element (1.1.38 M1).
 * The teacher defines columns (label + unit + number/text) and a row count; the
 * student gets that many empty rows to fill in the activity workspace.
 *
 * Single-table for v1.1 (the common lab-notebook case); `null` means "no table"
 * (the activity stays chat-only / checklist-only). The parent assigns positional
 * column ids + drops empty columns on save; columns 1-8 / rows 1-50 are enforced
 * here and re-validated server-side.
 */
export function TableEditor({ value, onChange }: TableEditorProps) {
  const nextKey = useRef(1);

  if (!value) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Data table (optional)</span>
          <button
            type="button"
            onClick={() =>
              onChange({
                title: "",
                columns: [{ key: nextKey.current++, label: "", unit: "", kind: "number" }],
                rows: 5,
              })
            }
            className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add data table
          </button>
        </div>
        <p className="text-xs text-slate-500">
          A grid the student fills in (e.g. trial · time · velocity). Entered values are shared with the
          tutor so the student can ask about their own measurements.
        </p>
      </div>
    );
  }

  const setColumn = (key: number, patch: Partial<TableEditorColumn>) =>
    onChange({ ...value, columns: value.columns.map((c) => (c.key === key ? { ...c, ...patch } : c)) });
  const removeColumn = (key: number) =>
    onChange({ ...value, columns: value.columns.filter((c) => c.key !== key) });
  const addColumn = () =>
    onChange({
      ...value,
      columns: [...value.columns, { key: nextKey.current++, label: "", unit: "", kind: "number" }],
    });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <TableIcon className="h-4 w-4 text-slate-500" /> Data table
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-600"
        >
          Remove table
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">Title (optional)</span>
        <input
          type="text"
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
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
            disabled={value.columns.length >= MAX_COLUMNS}
            className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Add column
          </button>
        </div>
        {value.columns.length === 0 ? (
          <p className="rounded border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">
            Add at least one column — a table with no columns won&apos;t be saved.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {value.columns.map((col, idx) => (
              <li key={col.key} className="flex items-center gap-2">
                <input
                  type="text"
                  aria-label={`Column ${idx + 1} label`}
                  value={col.label}
                  onChange={(e) => setColumn(col.key, { label: e.target.value })}
                  placeholder="Label (e.g. Tid)"
                  maxLength={80}
                  className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
                <input
                  type="text"
                  aria-label={`Column ${idx + 1} unit`}
                  value={col.unit}
                  onChange={(e) => setColumn(col.key, { unit: e.target.value })}
                  placeholder="Unit"
                  maxLength={24}
                  className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
                <select
                  aria-label={`Column ${idx + 1} type`}
                  value={col.kind}
                  onChange={(e) => setColumn(col.key, { kind: e.target.value as "number" | "text" })}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="number">Number</option>
                  <option value="text">Text</option>
                </select>
                <button
                  type="button"
                  onClick={() => removeColumn(col.key)}
                  aria-label={`Remove column ${idx + 1}`}
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
        <span className="text-xs font-medium text-slate-600">Empty rows for the student to fill</span>
        <input
          type="number"
          min={1}
          max={MAX_ROWS}
          value={value.rows}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange({ ...value, rows: Number.isNaN(n) ? 1 : Math.max(1, Math.min(MAX_ROWS, n)) });
          }}
          className="w-24 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
      </label>
    </div>
  );
}
