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

/** Tiers that ignore a natural-language delivery prompt. Chirp3-HD and WaveNet
 *  reject prompts outright, so offering the field for them would be a control
 *  that silently does nothing — the thing this sprint keeps finding. */
const PROMPTABLE = /gemini/i;

const copy = {
  title: "Faces and voices",
  blurb:
    "A tutor's face, name and voice. Pick a picture from the set, choose how it sounds, and use it on any tutor you build.",
  loading: "Loading…",
  failed: "Could not load the faces just now.",
  create: "New face",
  nameLabel: "Name",
  namePlaceholder: "e.g. Fru Hansen",
  titleLabel: "Title (optional)",
  titlePlaceholder: "e.g. Fysiklærer",
  avatarLabel: "Picture",
  avatarHelp: "Chosen from the pictures the project provides — more are added over time.",
  voiceLabel: "Voice",
  voiceNone: "No voice set (uses the default)",
  voicePromptLabel: "How it should sound",
  voicePromptPlaceholder: "e.g. Tal roligt og opmuntrende.",
  voicePromptOnlyGemini: "Only the Gemini voices follow this. The one you picked ignores it.",
  save: "Save",
  cancel: "Cancel",
  edit: "Edit",
  remove: "Delete",
  confirmRemove: (name: string) => `Delete ${name}? Tutors using it fall back to the default face.`,
  share: "Share with other teachers",
  unshare: "Make private again",
  badgeShared: "Shared",
  badgePrivate: "Only you",
  privateMeaning: "Private means other teachers cannot see it. The research team can.",
  none: "No faces of your own yet.",
  failedSave: "That could not be saved. Try again.",
};

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
      setError(copy.failedSave);
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
      setError(copy.failedSave);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: CustomPersona) => {
    if (!window.confirm(copy.confirmRemove(p.name))) return;
    setBusy(true);
    try {
      await deleteCustomPersona(p.id);
      load();
    } catch {
      setError(copy.failedSave);
    } finally {
      setBusy(false);
    }
  };

  if (failed) return <p className="text-sm text-muted-foreground">{copy.failed}</p>;
  if (rows === null) return <p className="text-sm text-muted-foreground">{copy.loading}</p>;

  const promptIgnored = Boolean(draft?.ttsVoice) && !PROMPTABLE.test(draft?.ttsVoice ?? "");

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
            onClick={() => setDraft({ ...EMPTY })}
            className="flex shrink-0 items-center gap-1.5 rounded border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {copy.create}
          </button>
        ) : null}
      </div>

      {draft ? (
        <div className="mt-4 space-y-3 border-t pt-4">
          <label className="block text-sm font-medium" htmlFor="persona-name">
            {copy.nameLabel}
          </label>
          <input
            id="persona-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={copy.namePlaceholder}
            className="w-full rounded border bg-background p-2 text-sm"
          />

          <label className="block text-sm font-medium" htmlFor="persona-title">
            {copy.titleLabel}
          </label>
          <input
            id="persona-title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder={copy.titlePlaceholder}
            className="w-full rounded border bg-background p-2 text-sm"
          />

          <fieldset>
            <legend className="text-sm font-medium">{copy.avatarLabel}</legend>
            <p className="text-xs text-muted-foreground">{copy.avatarHelp}</p>
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
            {copy.voiceLabel}
          </label>
          <select
            id="persona-voice"
            value={draft.ttsVoice}
            onChange={(e) => setDraft({ ...draft, ttsVoice: e.target.value })}
            className="w-full rounded border bg-background p-2 text-sm"
          >
            <option value="">{copy.voiceNone}</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.label}
              </option>
            ))}
          </select>

          <label className="block text-sm font-medium" htmlFor="persona-voice-prompt">
            {copy.voicePromptLabel}
          </label>
          <input
            id="persona-voice-prompt"
            value={draft.voicePrompt}
            onChange={(e) => setDraft({ ...draft, voicePrompt: e.target.value })}
            placeholder={copy.voicePromptPlaceholder}
            className="w-full rounded border bg-background p-2 text-sm"
          />
          {/* A control that silently does nothing is the failure this sprint
              keeps finding. Say so rather than hiding the field, which would
              make the setting vanish when a voice is changed. */}
          {promptIgnored ? (
            <p data-testid="voice-prompt-ignored" className="text-xs text-amber-700">
              {copy.voicePromptOnlyGemini}
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

      <div className="mt-4 flex flex-col gap-2">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">{copy.none}</p> : null}
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
                      {visibilityOf(p) === "shared" ? copy.badgeShared : copy.badgePrivate}
                    </span>
                    {visibilityOf(p) === "private" ? copy.privateMeaning : null}
                  </p>
                ) : null}
              </div>
            </div>
            {p.canEdit ? (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`${visibilityOf(p) === "shared" ? copy.unshare : copy.share}: ${p.name}`}
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
                  aria-label={`${copy.edit} ${p.name}`}
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
                  {copy.edit}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`${copy.remove} ${p.name}`}
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
