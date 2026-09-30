"use client";

import { FileUp, Plus } from "lucide-react";

import { useT } from "@/i18n";

export interface DocumentEditorValue {
  /** Teacher's prompt shown above the student's upload surface ("Upload your worksheet…"). */
  prompt: string;
}

interface DocumentEditorProps {
  value: DocumentEditorValue | null;
  onChange: (value: DocumentEditorValue | null) => void;
}

/**
 * DocumentEditor — the teacher-builder editor for the document-upload element
 * (1.1.48, JB-1 "din fil"; reconciled from the workbench_type="document" mode).
 * The teacher authors only the prompt; the *student* uploads their own file(s)
 * into the workbench and the tutor critiques the active one. One per activity;
 * `null` means none. Composes with any other elements.
 */
export function DocumentEditor({ value, onChange }: DocumentEditorProps) {
  const t = useT("DocumentEditor");
  if (!value) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">{t("optional")}</span>
          <button
            type="button"
            onClick={() => onChange({ prompt: "" })}
            className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" /> {t("add")}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          {t("help")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <FileUp className="h-4 w-4 text-slate-500" /> {t("title")}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-600"
        >
          {t("remove")}
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">{t("prompt")}</span>
        <textarea
          aria-label={t("promptAria")}
          value={value.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder={t("placeholder")}
          rows={3}
          maxLength={2000}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
    </div>
  );
}
