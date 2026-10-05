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
import { AuthorLine } from "@/components/teacher/research/AuthorLine";
import {
  ConflictError,
  createTutor,
  deleteTutor,
  fetchTutorCatalogue,
  listCustomPersonas,
  setTutorVisibility,
  type CustomPersona,
  type TutorCatalogue,
  type TutorPayload,
} from "@/lib/teacherApi";
import { useT } from "@/i18n";

// Copy lives in messages/*/teacher-research.json — 1.1.108.

export function MyTutorsPanel() {
  const t = useT("MyTutorsPanel");
  const tConsent = useT("ResearchConsent");
  const [catalogue, setCatalogue] = useState<TutorCatalogue | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variantParent, setVariantParent] = useState<TutorPayload | null>(null);
  const [draft, setDraft] = useState<{ displayName: string; frameworkId: string; personaId: string } | null>(null);
  // TUTOR-2 M3 — the faces a tutor can wear. Without this the persona editor
  // would be a stack with no consumer: a teacher could make a face and never
  // put it on anything, which is the bug M6 exists to catch, one layer up.
  const [personas, setPersonas] = useState<CustomPersona[]>([]);

  const load = useCallback(() => {
    fetchTutorCatalogue()
      .then(setCatalogue)
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    listCustomPersonas()
      .then((b) => setPersonas(b.personas))
      .catch(() => setPersonas([]));
  }, []);

  const visibilityOf = (tutor: TutorPayload) => tutor.visibility ?? "shared";

  const toggleShare = async (tutor: TutorPayload) => {
    setBusy(true);
    setError(null);
    try {
      await setTutorVisibility(tutor.id, visibilityOf(tutor) === "shared" ? "private" : "shared");
      // Re-read rather than patch: the server decides, and a list that guessed
      // would be a second copy of the rule canEdit exists to keep in one place.
      load();
    } catch {
      setError(t("failedSave"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tutor: TutorPayload) => {
    if (!window.confirm(t("confirmRemove", { name: tutor.displayName }))) return;
    setBusy(true);
    try {
      await deleteTutor(tutor.id);
      load();
    } catch {
      setError(t("failedSave"));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!draft) return;
    if (!draft.frameworkId) {
      setError(t("approachRequired"));
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
      await createTutor({
        id,
        displayName: draft.displayName.trim(),
        frameworkId: draft.frameworkId,
        personaId: draft.personaId || null,
      });
      setDraft(null);
      load();
    } catch (err) {
      // 1.1.150 F4 — the server now refuses a taken id (another person's tutor,
      // or a built-in like "Sofie") instead of silently overwriting it. Say so,
      // and keep the draft so the name can be changed.
      setError(err instanceof ConflictError ? t("nameTaken") : t("failedSave"));
    } finally {
      setBusy(false);
    }
  };

  if (failed) return <p className="text-sm text-muted-foreground">{t("failed")}</p>;
  if (catalogue === null) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;

  // 1.1.150 — grouped on `isOwn` (did I make it), NOT `canEdit` (may I change
  // it). A researcher may edit every authored tutor, so grouping on canEdit
  // put every teacher's tutor under a researcher's "Yours" — the 2026-10-05
  // seminar's "where has this come from?".
  const mine = catalogue.tutors.filter((tutor) => tutor.isOwn);
  const others = catalogue.tutors.filter((tutor) => !tutor.isOwn);
  const sourcesOf = (tutor: TutorPayload) =>
    catalogue.frameworks.find((f) => f.id === tutor.frameworkId && f.isCustom)?.sources ?? [];

  const row = (tutor: TutorPayload) => (
    <div key={tutor.id} className="flex items-start justify-between gap-3 rounded border px-3 py-2">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {tutor.displayName}
          {tutor.isVariant ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              {t("variantBadge")}
            </span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">{(tutor.frameworkName ? t("teaches", { name: tutor.frameworkName }) : t("teachesNone"))}</p>
        {sourcesOf(tutor).length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("derivedFrom", { list: sourcesOf(tutor).map((src) => src.citation).join("; ") })}
          </p>
        ) : null}
        <AuthorLine row={tutor} testId={`tutor-author-${tutor.id}`} />
        {tutor.canEdit ? (
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              data-testid={`tutor-visibility-${tutor.id}`}
              className={`rounded border px-1.5 py-0.5 ${
                visibilityOf(tutor) === "shared"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "border-border bg-muted"
              }`}
            >
              {visibilityOf(tutor) === "shared" ? t("badgeShared") : t("badgePrivate")}
            </span>
            {visibilityOf(tutor) === "private" ? tConsent("privateMeaning") : null}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={busy}
          aria-label={t("variantOf", { name: tutor.displayName })}
          onClick={() => setVariantParent(tutor)}
          className="rounded border p-1.5 hover:bg-muted disabled:opacity-50"
        >
          <GitBranch className="h-3.5 w-3.5" aria-hidden />
        </button>
        {tutor.canEdit ? (
          <>
            <button
              type="button"
              disabled={busy}
              aria-label={t("shareAria", { action: visibilityOf(tutor) === "shared" ? t("unshare") : t("share"), name: tutor.displayName })}
              onClick={() => void toggleShare(tutor)}
              className="rounded border p-1.5 hover:bg-muted disabled:opacity-50"
            >
              <Share2
                className={`h-3.5 w-3.5 ${visibilityOf(tutor) === "shared" ? "text-emerald-700" : ""}`}
                aria-hidden
              />
            </button>
            <button
              type="button"
              disabled={busy}
              aria-label={t("removeAria", { name: tutor.displayName })}
              onClick={() => void remove(tutor)}
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
          <h2 className="text-sm font-medium">{t("title")}</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t("blurb")}</p>
        </div>
        {!draft ? (
          <button
            type="button"
            onClick={() => setDraft({ displayName: "", frameworkId: "", personaId: "" })}
            className="flex shrink-0 items-center gap-1.5 rounded border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("newTutor")}
          </button>
        ) : null}
      </div>

      {draft ? (
        <div className="mt-4 space-y-3 border-t pt-4">
          <label className="block text-sm font-medium" htmlFor="tutor-name">
            {t("nameLabel")}
          </label>
          <input
            id="tutor-name"
            value={draft.displayName}
            onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
            placeholder={t("namePlaceholder")}
            className="w-full rounded border bg-background p-2 text-sm"
          />

          <label className="block text-sm font-medium" htmlFor="tutor-approach">
            {t("approachLabel")}
          </label>
          <p className="text-xs text-muted-foreground">{t("approachHelp")}</p>
          <select
            id="tutor-approach"
            value={draft.frameworkId}
            onChange={(e) => setDraft({ ...draft, frameworkId: e.target.value })}
            className="w-full rounded border bg-background p-2 text-sm"
          >
            <option value="">{t("approachNone")}</option>
            {catalogue.frameworks.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>

          <label className="block text-sm font-medium" htmlFor="tutor-persona">
            {t("faceLabel")}
          </label>
          <p className="text-xs text-muted-foreground">{t("faceHelp")}</p>
          <select
            id="tutor-persona"
            value={draft.personaId}
            onChange={(e) => setDraft({ ...draft, personaId: e.target.value })}
            className="w-full rounded border bg-background p-2 text-sm"
          >
            <option value="">{t("faceNone")}</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
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
              {t("save")}
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
          <h3 className="text-xs font-medium text-muted-foreground">{t("yours")}</h3>
          <div className="mt-1 flex flex-col gap-2">{mine.map(row)}</div>
        </div>
      ) : null}

      <div className="mt-4">
        <h3 className="text-xs font-medium text-muted-foreground">{t("others")}</h3>
        <div className="mt-1 flex flex-col gap-2">{others.map(row)}</div>
      </div>
    </TeacherCard>
  );
}
