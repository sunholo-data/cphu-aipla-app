"use client";

import { useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";

import { type ClassPayload, createClassForTeacher, listClasses } from "@/lib/teacherApi";
import { type OnboardingRow, fetchOnboarding } from "@/lib/programmeApi";
import { describeStage } from "@/lib/onboardingStage";
import { useT } from "@/i18n";

/** 1.1.108 M4 — copy lives here, never inline in JSX. */

/**
 * The researcher's shortcut (1.1.124 M2): take a teacher from *demo only* to
 * *waiting for students* in one dialog. Teachers come from the onboarding
 * rows that carry a uid (a class needs an owner that exists); templates are
 * the researcher's OWN classes — a plain class kept per subject is the
 * simplest "starter kit" there is, no new concept needed.
 */
export function SetUpForTeacherDialog({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const t = useT("SetUpForTeacherDialog");
  const [teachers, setTeachers] = useState<OnboardingRow[] | null>(null);
  const [templates, setTemplates] = useState<ClassPayload[]>([]);
  const [ownerUid, setOwnerUid] = useState("");
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchOnboarding()
      .then((r) => {
        if (!cancelled) setTeachers(r.teachers.filter((t) => t.uid));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "could not load teachers");
      });
    void listClasses("own")
      .then((cs) => {
        if (!cancelled) setTemplates(cs.filter((c) => !c.demo && c.name !== "Demo class"));
      })
      .catch(() => {
        /* templates are optional */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await createClassForTeacher({
        ownerUid,
        name: name.trim(),
        templateClassId: templateId || null,
      });
      const code = created.codes[0] ?? null;
      const n = created.copiedActivityIds.length;
      setResult(code ? t("doneWithCode", { name: created.name, code, n }) : t("doneNoCode", { name: created.name, n }));
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to set up the class");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-labelledby="setup-for-teacher-label" aria-modal="true" className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-lg border border-border bg-background p-4 shadow-lg">
        <div className="mb-2 flex items-start justify-between gap-2">
          <h2 id="setup-for-teacher-label" className="flex items-center gap-2 text-base font-semibold">
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            {t("title")}
          </h2>
          <button type="button" onClick={onCancel} aria-label={t("cancel")} className="rounded p-1 hover:bg-accent">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t("intro")}</p>

        {result ? (
          <p role="status" className="mb-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            {result}
          </p>
        ) : null}

        <label className="mb-2 block text-sm">
          <span className="mb-1 block font-medium">{t("teacher")}</span>
          {teachers && teachers.length === 0 ? (
            <span className="text-xs text-muted-foreground">{t("noTeachers")}</span>
          ) : (
            <select
              required
              value={ownerUid}
              onChange={(e) => setOwnerUid(e.target.value)}
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">{t("teacherPlaceholder")}</option>
              {(teachers ?? []).map((t) => (
                <option key={t.uid!} value={t.uid!}>
                  {t.email} — {describeStage(t)}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="mb-2 block text-sm">
          <span className="mb-1 block font-medium">{t("name")}</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium">{t("template")}</span>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm">
            <option value="">{t("noTemplate")}</option>
            {templates.map((c) => (
              <option key={c.classId} value={c.classId}>
                {c.name} ({(c.activityIds ?? []).length})
              </option>
            ))}
          </select>
        </label>

        {error ? (
          <p role="alert" className="mb-2 rounded border border-destructive bg-destructive/10 px-2 py-1 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded border border-border px-3 py-1.5 text-sm hover:bg-accent">
            {result ? t("close") : t("cancel")}
          </button>
          {result ? null : (
            <button type="submit" disabled={busy || !ownerUid || !name.trim()} className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
              {busy ? t("submitting") : t("submit")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
