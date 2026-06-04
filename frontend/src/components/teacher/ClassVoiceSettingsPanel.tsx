"use client";

/**
 * 1.1.11 — Voice settings panel for the teacher's class-detail page.
 *
 * Picks per-class read-aloud language + voice. Saves to
 * `classes/<class_id>.voice` via PUT /api/voice/class/{id}/settings.
 *
 * Resolution order (server-side):
 *   student localStorage > THIS PANEL > skill default > env
 *
 * Voices come from the curated /api/voice/voices catalogue (covers
 * Standard, WaveNet, Neural2, Chirp3 HD — all four price tiers so
 * the teacher can A/B quality vs cost). Voice list filters to the
 * currently-selected language.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, X } from "lucide-react";

import {
  type ClassVoiceSettingsPayload,
  type VoiceListEntry,
  type VoiceListResponse,
  fetchVoiceList,
  setClassVoiceSettings,
} from "@/lib/teacherApi";

interface Props {
  classId: string;
  initial: ClassVoiceSettingsPayload | null | undefined;
  onSaved: () => void;
}

const LANG_LABEL: Record<string, string> = {
  da: "Dansk (da-DK)",
  en: "English (en-US)",
};

export function ClassVoiceSettingsPanel({ classId, initial, onSaved }: Props) {
  const [language, setLanguage] = useState<string>(initial?.language ?? "");
  const [voice, setVoice] = useState<string>(initial?.voice ?? "");
  const [voicesByLang, setVoicesByLang] = useState<VoiceListResponse | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchVoiceList()
      .then((data) => {
        if (!cancelled) setVoicesByLang(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "failed to load voices");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // When language changes, clear the voice if it doesn't belong to the
  // new lang's catalogue. Avoids invalid (lang, voice) pairs on save.
  useEffect(() => {
    if (!voicesByLang || !language) return;
    const ok = voicesByLang.voices[language]?.some((v) => v.name === voice);
    if (!ok) setVoice("");
  }, [language, voicesByLang, voice]);

  const availableVoices: VoiceListEntry[] = useMemo(() => {
    if (!voicesByLang || !language) return [];
    return voicesByLang.voices[language] ?? [];
  }, [voicesByLang, language]);

  const selectedVoiceEntry = useMemo(
    () => availableVoices.find((v) => v.name === voice),
    [availableVoices, voice],
  );

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const body: ClassVoiceSettingsPayload = {
        language: language || null,
        voice: voice || null,
        provider: selectedVoiceEntry?.provider ?? null,
      };
      await setClassVoiceSettings(classId, body);
      setToast("Voice settings saved");
      setTimeout(() => setToast(null), 2500);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    setError(null);
    try {
      await setClassVoiceSettings(classId, {
        language: null,
        voice: null,
        provider: null,
      });
      setLanguage("");
      setVoice("");
      setToast("Reverted to skill defaults");
      setTimeout(() => setToast(null), 2500);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to clear");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="voice-settings-label"
      className="flex flex-col gap-3"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="voice-settings-label" className="text-lg font-semibold">
          Voice (read-aloud)
        </h2>
        <span className="text-xs text-muted-foreground">
          Students can override their language; only the teacher picks
          the voice.
        </span>
      </header>

      <div className="grid grid-cols-1 gap-3 rounded border border-border p-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Language</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="rounded border border-border bg-background px-2 py-1.5"
          >
            <option value="">— skill default —</option>
            {voicesByLang?.languages.map((l) => (
              <option key={l} value={l}>
                {LANG_LABEL[l] ?? l}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Voice</span>
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            disabled={!language || availableVoices.length === 0}
            className="rounded border border-border bg-background px-2 py-1.5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">— first available for tier —</option>
            {availableVoices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.label}
                {v.gender === "F" ? " ♀" : v.gender === "M" ? " ♂" : ""}
              </option>
            ))}
          </select>
        </label>

        {selectedVoiceEntry ? (
          <p className="md:col-span-2 text-xs text-muted-foreground">
            Tier: <strong className="font-medium">{selectedVoiceEntry.tier}</strong>{" "}
            ({selectedVoiceEntry.provider}) — Cloud TTS pricing applies per
            character. WaveNet = $4/M chars (cheap + natural); Neural2 =
            $16/M; Chirp3 HD = $30/M.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            Save voice settings
          </button>
          {(initial?.language || initial?.voice || initial?.provider) ? (
            <button
              type="button"
              onClick={handleClear}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Revert to skill default
            </button>
          ) : null}
          {toast ? <span className="text-xs text-emerald-600">{toast}</span> : null}
          {error ? <span className="text-xs text-red-600">{error}</span> : null}
        </div>
      </div>
    </section>
  );
}
