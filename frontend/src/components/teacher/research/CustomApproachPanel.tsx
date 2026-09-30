"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Share2, Trash2 } from "lucide-react";

import {
  type CustomApproach,
  type FrameworkRegister,
  createCustomApproach,
  deleteCustomApproach,
  listCustomApproaches,
  setCustomApproachVisibility,
  updateCustomApproach,
} from "@/lib/teacherApi";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";
import { RegisterPicker } from "@/components/teacher/research/RegisterPicker";
import { useT } from "@/i18n";

/** UI copy, lifted out of JSX (1.1.108 M4) so a translator can reach it. */
// Copy lives in messages/*/teacher-research.json — 1.1.108.

interface Draft {
  id: string | null;
  label: string;
  summary: string;
  instructionText: string;
  register: FrameworkRegister | null;
}

const EMPTY: Draft = { id: null, label: "", summary: "", instructionText: "", register: null };

/**
 * Custom teaching approaches (1.1.110) — the teacher-editable tier.
 *
 * The honest home for free-text authoring. The hand-written-instruction editor
 * that used to sit on the seven published frameworks let anyone overwrite a
 * derived prompt in place while the badge still said "generated" — the
 * capability was fine, the claim attached to it was not. Here the same
 * capability declares what it is.
 *
 * `canEdit` arrives per row from the server and is never re-derived here.
 */
export function CustomApproachPanel() {
  const t = useT("CustomApproachPanel");
  const tConsent = useT("ResearchConsent");
  const [rows, setRows] = useState<CustomApproach[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listCustomApproaches()
      .then(setRows)
      .catch(() => setError(t("loadFailed")));
  }, [t]);

  useEffect(load, [load]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const input = {
        label: draft.label.trim(),
        summary: draft.summary.trim(),
        instructionText: draft.instructionText.trim(),
        register: draft.register,
      };
      if (draft.id) await updateCustomApproach(draft.id, input);
      else await createCustomApproach(input);
      setDraft(null);
      load();
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: CustomApproach) => {
    if (!window.confirm(`${t("confirmRemove", { label: row.label })}\n\n${t("deleteWarning")}`)) return;
    setBusy(true);
    try {
      await deleteCustomApproach(row.id);
      load();
    } finally {
      setBusy(false);
    }
  };

  /** Share, or take it back (TUTOR-2 M0). Re-reads rather than patching local
   *  state: the server decides, and a list that guessed would be a second copy
   *  of the rule — the thing `canEdit` is computed server-side to avoid. */
  const toggleShare = async (row: CustomApproach) => {
    setBusy(true);
    try {
      await setCustomApproachVisibility(row.id, (row.visibility ?? "shared") === "shared" ? "private" : "shared");
      load();
    } finally {
      setBusy(false);
    }
  };

  const valid = draft && draft.label.trim().length > 0 && draft.instructionText.trim().length > 0;

  return (
    <TeacherCard>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-medium">{t("title")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("blurb")}</p>
          <p className="mt-2 max-w-2xl rounded border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t("researchersCanSee")}
          </p>
        </div>
        {!draft ? (
          <button
            type="button"
            onClick={() => setDraft({ ...EMPTY })}
            className="flex shrink-0 items-center gap-1.5 rounded border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("create")}
          </button>
        ) : null}
      </div>

      {draft ? (
        <div className="mt-4 space-y-3 border-t pt-4">
          <label className="block text-sm font-medium" htmlFor="custom-label">
            {t("nameLabel")}
          </label>
          <input
            id="custom-label"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder={t("namePlaceholder")}
            className="w-full rounded border bg-background p-2 text-sm"
          />

          <label className="block text-sm font-medium" htmlFor="custom-summary">
            {t("summaryLabel")}
          </label>
          <input
            id="custom-summary"
            value={draft.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            placeholder={t("summaryPlaceholder")}
            className="w-full rounded border bg-background p-2 text-sm"
          />

          <label className="block text-sm font-medium" htmlFor="custom-instruction">
            {t("instructionLabel")}
          </label>
          <textarea
            id="custom-instruction"
            value={draft.instructionText}
            onChange={(e) => setDraft({ ...draft, instructionText: e.target.value })}
            placeholder={t("instructionPlaceholder")}
            rows={10}
            className="w-full rounded border bg-background p-3 font-mono text-xs"
          />

          {/* A custom approach's voice. The warning here is usually moot — free
              text has no parsed "moves" to contradict — but the control is the
              same one, so the two editors cannot drift apart. */}
          <RegisterPicker value={draft.register} onChange={(register) => setDraft({ ...draft, register })} />

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !valid}
              onClick={() => void save()}
              className="rounded bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {busy ? t("saving") : t("save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              className="rounded border px-3 py-1.5 text-sm hover:bg-muted"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {rows === null ? null : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="flex items-start justify-between gap-3 rounded border px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {row.label}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {row.canEdit && row.authorRole ? t("byYou") : t(
                          row.authorRole === "teacher"
                            ? "byOther_teacher"
                            : row.authorRole === "researcher"
                              ? "byOther_researcher"
                              : "byOther_colleague",
                        )}
                  </span>
                </p>
                {row.summary ? <p className="text-xs text-muted-foreground">{row.summary}</p> : null}
                {!row.canEdit ? <p className="mt-1 text-xs text-muted-foreground">{t("readOnly")}</p> : null}
                {row.canEdit ? (
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span
                      data-testid={`approach-visibility-${row.id}`}
                      className={`rounded border px-1.5 py-0.5 ${
                        (row.visibility ?? "shared") === "shared"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                          : "border-border bg-muted"
                      }`}
                    >
                      {(row.visibility ?? "shared") === "shared" ? t("badgeShared") : t("badgePrivate")}
                    </span>
                    {(row.visibility ?? "shared") === "private" ? tConsent("privateMeaning") : null}
                  </p>
                ) : null}
              </div>
              {row.canEdit ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={t("shareAria", { action: (row.visibility ?? "shared") === "shared" ? t("unshare") : t("share"), label: row.label })}
                    onClick={() => void toggleShare(row)}
                    className="rounded border p-1.5 hover:bg-muted"
                  >
                    <Share2
                      className={`h-3.5 w-3.5 ${(row.visibility ?? "shared") === "shared" ? "text-emerald-700" : ""}`}
                      aria-hidden
                    />
                  </button>
                  <button
                    type="button"
                    aria-label={t("editAria", { label: row.label })}
                    onClick={() =>
                      setDraft({
                        id: row.id,
                        label: row.label,
                        summary: row.summary,
                        instructionText: row.instructionText,
                        register: row.register,
                      })
                    }
                    className="rounded border p-1.5 hover:bg-muted"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={t("removeAria", { label: row.label })}
                    onClick={() => void remove(row)}
                    className="rounded border p-1.5 hover:bg-muted"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </TeacherCard>
  );
}
