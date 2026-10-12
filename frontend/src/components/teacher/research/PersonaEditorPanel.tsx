"use client";

// PersonaEditorPanel — a tutor's face and voice (TUTOR-2 M3/M4/M5).
//
// `Persona.source` had been Literal["yaml"] since 1.1.12, its own docstring
// calling the Firestore layer "a v1.2 follow-up". Until it arrived, the six
// personas were files in git with avatars under frontend/public — neither of
// which a teacher can write. This is the panel that makes "give your tutor a
// face and a voice" a thing a teacher can actually do.
//
// ⚠️ The avatar is CHOSEN from a set the project ships, never uploaded. M,
// 2026-09-28. An uploaded image would be the first user-generated
// student-facing content in AIPLA, attached to a class for a term, and would
// need a moderation policy nobody has written. The backend refuses an avatar
// outside the manifest, so this is not a UI-only rule.

import { useCallback, useEffect, useState } from "react";
import { Plus, Share2, Trash2 } from "lucide-react";

import { TeacherCard } from "@/components/teacher/ui/TeacherCard";
import { AuthorLine } from "@/components/teacher/research/AuthorLine";
import { AVATAR_CHOICES } from "@/lib/avatarManifest";
import {
  createCustomPersona,
  deleteCustomPersona,
  fetchVoiceList,
  listCustomPersonas,
  setCustomPersonaVisibility,
  updateCustomPersona,
  type CustomPersona,
  type VoiceListEntry,
} from "@/lib/teacherApi";
import { useT } from "@/i18n";

/** Tiers that ignore a natural-language delivery prompt. Chirp3-HD and WaveNet
 *  reject prompts outright, so offering the field for them would be a control
 *  that silently does nothing — the thing this sprint keeps finding. */
const PROMPTABLE = /gemini/i;

// Copy lives in messages/*/teacher-research.json — 1.1.108.

type Draft = {
  id?: string;
  name: string;
  title: string;
  avatar: string;
  ttsVoice: string;
  voicePrompt: string;
};

const EMPTY: Draft = { name: "", title: "", avatar: "", ttsVoice: "", voicePrompt: "" };

export function PersonaEditorPanel() {
  const t = useT("PersonaEditorPanel");
  const tConsent = useT("ResearchConsent");
  const [rows, setRows] = useState<CustomPersona[] | null>(null);
  const [voices, setVoices] = useState<VoiceListEntry[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    listCustomPersonas()
      .then((b) => setRows(b.personas))
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load();
    // The curated catalogue (1.1.11) has had a typed client and no picker for
    // months — this is its first consumer.
    fetchVoiceList()
      .then((v) => setVoices(Object.values(v.voices).flat()))
      .catch(() => setVoices([]));
  }, [load]);

  const visibilityOf = (p: CustomPersona) => p.visibility ?? "shared";

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const input = {
      name: draft.name.trim(),
      title: draft.title.trim() || null,
      avatar: draft.avatar,
      voice: draft.ttsVoice ? { ttsVoice: draft.ttsVoice } : null,
      voicePrompt: draft.voicePrompt.trim() || null,
    };
    try {
      if (draft.id) await updateCustomPersona(draft.id, input);
      else await createCustomPersona(input);
      setDraft(null);
      load();
    } catch {
      setError(t("failedSave"));
    } finally {
      setBusy(false);
    }
  };

  const toggleShare = async (p: CustomPersona) => {
    setBusy(true);
    try {
      await setCustomPersonaVisibility(p.id, visibilityOf(p) === "shared" ? "private" : "shared");
      load();
    } catch {
      setError(t("failedSave"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: CustomPersona) => {
    if (!window.confirm(t("confirmRemove", { name: p.name }))) return;
    setBusy(true);
    try {
      await deleteCustomPersona(p.id);
      load();
    } catch {
      setError(t("failedSave"));
    } finally {
      setBusy(false);
    }
  };

  if (failed) return <p className="text-sm text-muted-foreground">{t("failed")}</p>;
  if (rows === null) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;

  const promptIgnored = Boolean(draft?.ttsVoice) && !PROMPTABLE.test(draft?.ttsVoice ?? "");

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
          <label className="block text-sm font-medium" htmlFor="persona-name">
            {t("nameLabel")}
          </label>
          <input
            id="persona-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={t("namePlaceholder")}
            className="w-full rounded border bg-background p-2 text-sm"
          />

          <label className="block text-sm font-medium" htmlFor="persona-title">
            {t("titleLabel")}
          </label>
          <input
            id="persona-title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder={t("titlePlaceholder")}
            className="w-full rounded border bg-background p-2 text-sm"
          />

          <fieldset>
            <legend className="text-sm font-medium">{t("avatarLabel")}</legend>
            <p className="text-xs text-muted-foreground">{t("avatarHelp")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {AVATAR_CHOICES.map((a) => (
                <button
                  key={a.path}
                  type="button"
                  aria-label={a.label}
                  aria-pressed={draft.avatar === a.path}
                  onClick={() => setDraft({ ...draft, avatar: a.path })}
                  className={`overflow-hidden rounded-full border-2 ${
                    draft.avatar === a.path ? "border-brand" : "border-transparent hover:border-border"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.path} alt={a.label} width={48} height={48} className="h-12 w-12 object-cover" />
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm font-medium" htmlFor="persona-voice">
            {t("voiceLabel")}
          </label>
          <select
            id="persona-voice"
            value={draft.ttsVoice}
            onChange={(e) => setDraft({ ...draft, ttsVoice: e.target.value })}
            className="w-full rounded border bg-background p-2 text-sm"
          >
            <option value="">{t("voiceNone")}</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.label}
              </option>
            ))}
          </select>

          <label className="block text-sm font-medium" htmlFor="persona-voice-prompt">
            {t("voicePromptLabel")}
          </label>
          <input
            id="persona-voice-prompt"
            value={draft.voicePrompt}
            onChange={(e) => setDraft({ ...draft, voicePrompt: e.target.value })}
            placeholder={t("voicePromptPlaceholder")}
            className="w-full rounded border bg-background p-2 text-sm"
          />
          {/* A control that silently does nothing is the failure this sprint
              keeps finding. Say so rather than hiding the field, which would
              make the setting vanish when a voice is changed. */}
          {promptIgnored ? (
            <p data-testid="voice-prompt-ignored" className="text-xs text-amber-700">
              {t("voicePromptOnlyGemini")}
            </p>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !draft.name.trim()}
              onClick={() => void save()}
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

      <div className="mt-4 flex flex-col gap-2">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
        {rows.map((p) => (
          <div key={p.id} className="flex items-start justify-between gap-3 rounded border px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              {p.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.avatar} alt="" width={32} height={32} className="h-8 w-8 rounded-full object-cover" />
              ) : null}
              <div className="min-w-0">
                <p className="text-sm font-medium">{p.name}</p>
                {p.title ? <p className="text-xs text-muted-foreground">{p.title}</p> : null}
                {/* 1.1.150 — who made this face, from `isOwn`, never `canEdit`. */}
                <AuthorLine row={p} testId={`persona-author-${p.id}`} />
                {p.canEdit ? (
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span
                      data-testid={`persona-visibility-${p.id}`}
                      className={`rounded border px-1.5 py-0.5 ${
                        visibilityOf(p) === "shared"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                          : "border-border bg-muted"
                      }`}
                    >
                      {visibilityOf(p) === "shared" ? t("badgeShared") : t("badgePrivate")}
                    </span>
                    {visibilityOf(p) === "private" ? tConsent("privateMeaning") : null}
                  </p>
                ) : null}
              </div>
            </div>
            {p.canEdit ? (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t("shareAria", { action: visibilityOf(p) === "shared" ? t("unshare") : t("share"), name: p.name })}
                  onClick={() => void toggleShare(p)}
                  className="rounded border p-1.5 hover:bg-muted disabled:opacity-50"
                >
                  <Share2
                    className={`h-3.5 w-3.5 ${visibilityOf(p) === "shared" ? "text-emerald-700" : ""}`}
                    aria-hidden
                  />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t("editAria", { name: p.name })}
                  onClick={() =>
                    setDraft({
                      id: p.id,
                      name: p.name,
                      title: p.title ?? "",
                      avatar: p.avatar,
                      ttsVoice: p.voice?.ttsVoice ?? "",
                      voicePrompt: p.voicePrompt ?? "",
                    })
                  }
                  className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                >
                  {t("edit")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t("removeAria", { name: p.name })}
                  onClick={() => void remove(p)}
                  className="rounded border p-1.5 hover:bg-muted disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </TeacherCard>
  );
}
