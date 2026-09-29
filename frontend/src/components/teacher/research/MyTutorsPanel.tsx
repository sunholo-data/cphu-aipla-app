"use client";

// MyTutorsPanel — where a tutor is made (TUTOR-2 M2).
//
// This is the home TutorVariantDialog's own docstring asked for on 2026-09-11,
// when it was dropped from TutorPicker: "a class is where you CHOOSE a tutor;
// authoring a research instrument is a different job done at a different
// moment". It sat mounted nowhere for eighteen days, and zero variants exist on
// any environment as a result.
//
// Two ways to make one, and the difference is the point:
//   • a VARIANT of an existing tutor — same face, different approach. What
//     separates pedagogy from face, voice and tone when two arms are compared
//     (1.1.91's stated reason for carrying lineage at all).
//   • a NEW tutor, which a teacher may author provided it NAMES AN APPROACH.
//     1.1.91 M1 kept teachers out because "a tutor with a theory field and no
//     theory in it makes an unfounded claim look founded" — the objection is
//     about the claim, so the gate moved from the person to the tutor.

import { useCallback, useEffect, useState } from "react";
import { GitBranch, Plus, Share2, Trash2 } from "lucide-react";

import { TutorVariantDialog } from "@/components/teacher/TutorVariantDialog";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";
import {
  createTutor,
  deleteTutor,
  fetchTutorCatalogue,
  setTutorVisibility,
  type TutorCatalogue,
  type TutorPayload,
} from "@/lib/teacherApi";

const copy = {
  title: "Tutors",
  blurb:
    "A tutor is a face, a voice and a teaching approach. Build one on any published approach or on one of your own — or take an existing tutor and change just its approach, which keeps everything else the same.",
  loading: "Loading tutors…",
  failed: "The tutors could not be loaded just now.",
  yours: "Yours",
  others: "Available to you",
  newTutor: "New tutor",
  variantOf: (name: string) => `Make a variant of ${name}`,
  nameLabel: "Name",
  namePlaceholder: "e.g. Sofie, but Socratic",
  approachLabel: "Teaching approach",
  approachHelp: "A tutor has to say how it teaches. Pick a published approach or one of your own.",
  approachRequired: "Choose a teaching approach.",
  approachNone: "Choose an approach…",
  save: "Create tutor",
  cancel: "Cancel",
  share: "Share with other teachers",
  unshare: "Make private again",
  badgeShared: "Shared",
  badgePrivate: "Only you",
  // ⚠️ Said plainly: "private" is otherwise a promise the research design does
  // not keep. Same line as the approaches panel, deliberately identical.
  privateMeaning: "Private means other teachers cannot see it. The research team can.",
  remove: "Delete",
  confirmRemove: (name: string) => `Delete ${name}? Any class using it falls back to the default tutor.`,
  teaches: (name: string | null) => (name ? `Teaches with ${name}` : "No teaching approach set"),
  variantBadge: "variant",
  failedSave: "That could not be saved. Try again.",
};

export function MyTutorsPanel() {
  const [catalogue, setCatalogue] = useState<TutorCatalogue | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variantParent, setVariantParent] = useState<TutorPayload | null>(null);
  const [draft, setDraft] = useState<{ displayName: string; frameworkId: string } | null>(null);

  const load = useCallback(() => {
    fetchTutorCatalogue()
      .then(setCatalogue)
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  const visibilityOf = (t: TutorPayload) => t.visibility ?? "shared";

  const toggleShare = async (t: TutorPayload) => {
    setBusy(true);
    setError(null);
    try {
      await setTutorVisibility(t.id, visibilityOf(t) === "shared" ? "private" : "shared");
      // Re-read rather than patch: the server decides, and a list that guessed
      // would be a second copy of the rule canEdit exists to keep in one place.
      load();
    } catch {
      setError(copy.failedSave);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: TutorPayload) => {
    if (!window.confirm(copy.confirmRemove(t.displayName))) return;
    setBusy(true);
    try {
      await deleteTutor(t.id);
      load();
    } catch {
      setError(copy.failedSave);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!draft) return;
    if (!draft.frameworkId) {
      setError(copy.approachRequired);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = draft.displayName
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
      await createTutor({ id, displayName: draft.displayName.trim(), frameworkId: draft.frameworkId });
      setDraft(null);
      load();
    } catch {
      setError(copy.failedSave);
    } finally {
      setBusy(false);
    }
  };

  if (failed) return <p className="text-sm text-muted-foreground">{copy.failed}</p>;
  if (catalogue === null) return <p className="text-sm text-muted-foreground">{copy.loading}</p>;

  const mine = catalogue.tutors.filter((t) => t.canEdit);
  const others = catalogue.tutors.filter((t) => !t.canEdit);

  const row = (t: TutorPayload) => (
    <div key={t.id} className="flex items-start justify-between gap-3 rounded border px-3 py-2">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {t.displayName}
          {t.isVariant ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              {copy.variantBadge}
            </span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">{copy.teaches(t.frameworkName)}</p>
        {t.canEdit ? (
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              data-testid={`tutor-visibility-${t.id}`}
              className={`rounded border px-1.5 py-0.5 ${
                visibilityOf(t) === "shared"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "border-border bg-muted"
              }`}
            >
              {visibilityOf(t) === "shared" ? copy.badgeShared : copy.badgePrivate}
            </span>
            {visibilityOf(t) === "private" ? copy.privateMeaning : null}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={busy}
          aria-label={copy.variantOf(t.displayName)}
          onClick={() => setVariantParent(t)}
          className="rounded border p-1.5 hover:bg-muted disabled:opacity-50"
        >
          <GitBranch className="h-3.5 w-3.5" aria-hidden />
        </button>
        {t.canEdit ? (
          <>
            <button
              type="button"
              disabled={busy}
              aria-label={`${visibilityOf(t) === "shared" ? copy.unshare : copy.share}: ${t.displayName}`}
              onClick={() => void toggleShare(t)}
              className="rounded border p-1.5 hover:bg-muted disabled:opacity-50"
            >
              <Share2
                className={`h-3.5 w-3.5 ${visibilityOf(t) === "shared" ? "text-emerald-700" : ""}`}
                aria-hidden
              />
            </button>
            <button
              type="button"
              disabled={busy}
              aria-label={`${copy.remove} ${t.displayName}`}
              onClick={() => void remove(t)}
              className="rounded border p-1.5 hover:bg-muted disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );

  return (
    <TeacherCard>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{copy.title}</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{copy.blurb}</p>
        </div>
        {!draft ? (
          <button
            type="button"
            onClick={() => setDraft({ displayName: "", frameworkId: "" })}
            className="flex shrink-0 items-center gap-1.5 rounded border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {copy.newTutor}
          </button>
        ) : null}
      </div>

      {draft ? (
        <div className="mt-4 space-y-3 border-t pt-4">
          <label className="block text-sm font-medium" htmlFor="tutor-name">
            {copy.nameLabel}
          </label>
          <input
            id="tutor-name"
            value={draft.displayName}
            onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
            placeholder={copy.namePlaceholder}
            className="w-full rounded border bg-background p-2 text-sm"
          />

          <label className="block text-sm font-medium" htmlFor="tutor-approach">
            {copy.approachLabel}
          </label>
          <p className="text-xs text-muted-foreground">{copy.approachHelp}</p>
          <select
            id="tutor-approach"
            value={draft.frameworkId}
            onChange={(e) => setDraft({ ...draft, frameworkId: e.target.value })}
            className="w-full rounded border bg-background p-2 text-sm"
          >
            <option value="">{copy.approachNone}</option>
            {catalogue.frameworks.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !draft.displayName.trim()}
              onClick={() => void create()}
              className="rounded border bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
              {copy.save}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              className="rounded border px-3 py-1.5 text-sm hover:bg-muted"
            >
              {copy.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {variantParent ? (
        <div className="mt-4 border-t pt-4">
          <TutorVariantDialog
            parent={variantParent}
            frameworks={catalogue.frameworks}
            onCreated={() => {
              setVariantParent(null);
              load();
            }}
            onCancel={() => setVariantParent(null)}
          />
        </div>
      ) : null}

      {error && !draft ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      {mine.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-medium text-muted-foreground">{copy.yours}</h3>
          <div className="mt-1 flex flex-col gap-2">{mine.map(row)}</div>
        </div>
      ) : null}

      <div className="mt-4">
        <h3 className="text-xs font-medium text-muted-foreground">{copy.others}</h3>
        <div className="mt-1 flex flex-col gap-2">{others.map(row)}</div>
      </div>
    </TeacherCard>
  );
}
