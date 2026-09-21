"use client";

import { useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";

import { type ClassPayload, createClassForTeacher, listClasses } from "@/lib/teacherApi";
import { type OnboardingRow, fetchOnboarding } from "@/lib/programmeApi";
import { describeStage } from "@/lib/onboardingStage";

/** 1.1.108 M4 — copy lives here, never inline in JSX. */
const copy = {
  button: "Set up a class for a teacher…",
  title: "Set up a class for a teacher",
  intro:
    "The class will belong to the teacher. Activities from your template are copied into their library, and a join code is minted if they may spend. Their checklist then opens at “share the join link”.",
  teacher: "Teacher",
  teacherPlaceholder: "Choose a granted teacher who has signed in",
  noTeachers: "Nobody on the register has signed in yet — a class needs an account to belong to.",
  name: "Class name",
  namePlaceholder: "e.g. Fysik 1.g — efterår",
  template: "Copy activities from",
  noTemplate: "None — an empty class",
  submit: "Set up class",
  submitting: "Setting up…",
  cancel: "Cancel",
  done: (name: string, code: string | null, n: number) =>
    code
      ? `${name} is ready: ${n} ${n === 1 ? "activity" : "activities"} copied, join code ${code}.`
      : `${name} is ready with ${n} ${n === 1 ? "activity" : "activities"} — no join code, the teacher is not on the spend register.`,
} as const;

/**
 * The researcher's shortcut (1.1.124 M2): take a teacher from *demo only* to
 * *waiting for students* in one dialog. Teachers come from the onboarding
 * rows that carry a uid (a class needs an owner that exists); templates are
 * the researcher's OWN classes — a plain class kept per subject is the
 * simplest "starter kit" there is, no new concept needed.
 */
export function SetUpForTeacherDialog({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
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
      setResult(copy.done(created.name, created.codes[0] ?? null, created.copiedActivityIds.length));
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
            {copy.title}
          </h2>
          <button type="button" onClick={onCancel} aria-label={copy.cancel} className="rounded p-1 hover:bg-accent">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{copy.intro}</p>

        {result ? (
          <p role="status" className="mb-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            {result}
          </p>
        ) : null}

        <label className="mb-2 block text-sm">
          <span className="mb-1 block font-medium">{copy.teacher}</span>
          {teachers && teachers.length === 0 ? (
            <span className="text-xs text-muted-foreground">{copy.noTeachers}</span>
          ) : (
            <select
              required
              value={ownerUid}
              onChange={(e) => setOwnerUid(e.target.value)}
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">{copy.teacherPlaceholder}</option>
              {(teachers ?? []).map((t) => (
                <option key={t.uid!} value={t.uid!}>
                  {t.email} — {describeStage(t)}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="mb-2 block text-sm">
          <span className="mb-1 block font-medium">{copy.name}</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={copy.namePlaceholder}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium">{copy.template}</span>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm">
            <option value="">{copy.noTemplate}</option>
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
            {result ? "Close" : copy.cancel}
          </button>
          {result ? null : (
            <button type="submit" disabled={busy || !ownerUid || !name.trim()} className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
              {busy ? copy.submitting : copy.submit}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export const setUpForTeacherCopy = copy;
