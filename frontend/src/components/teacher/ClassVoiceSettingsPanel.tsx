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
import { useToast } from "@/hooks/useToast";
import { Loader2, Save, X } from "lucide-react";

import {
  type ClassVoiceSettingsPayload,
  type VoiceListEntry,
  type VoiceListResponse,
  fetchVoiceList,
  setClassCapabilities,
  setClassVoiceSettings,
} from "@/lib/teacherApi";
import { AdvancedDisclosure, SettingRow } from "@/components/teacher/ui";

interface Props {
  classId: string;
  initial: ClassVoiceSettingsPayload | null | undefined;
  /** VOICE-IN-REC M4 — current per-class capability toggles. */
  initialVoiceInput?: boolean;
  initialRecording?: boolean;
  onSaved: () => void;
}

const LANG_LABEL: Record<string, string> = {
  da: "Dansk (da-DK)",
  en: "English (en-US)",
};

export function ClassVoiceSettingsPanel({
  classId,
  initial,
  initialVoiceInput = false,
  initialRecording = false,
  onSaved,
}: Props) {
  const [language, setLanguage] = useState<string>(initial?.language ?? "");
  const [voice, setVoice] = useState<string>(initial?.voice ?? "");
  const [voicesByLang, setVoicesByLang] = useState<VoiceListResponse | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  // VOICE-IN-REC M4 — the two plain capability toggles. Optimistic + save on
  // change (no extra Save button — the point is fewer steps, not more).
  const [voiceInput, setVoiceInput] = useState<boolean>(initialVoiceInput);
  const [recording, setRecording] = useState<boolean>(initialRecording);
  const [capBusy, setCapBusy] = useState(false);

  async function toggleCapability(which: "voiceInput" | "recording", next: boolean) {
    setCapBusy(true);
    setError(null);
    // optimistic
    if (which === "voiceInput") setVoiceInput(next);
    else setRecording(next);
    try {
      await setClassCapabilities(
        classId,
        which === "voiceInput" ? { voiceInputEnabled: next } : { recordingEnabled: next },
      );
      showToast(next ? "Enabled" : "Disabled", 2000);
      onSaved();
    } catch (err) {
      // revert on failure
      if (which === "voiceInput") setVoiceInput(!next);
      else setRecording(!next);
      setError(err instanceof Error ? err.message : "failed to save");
    } finally {
      setCapBusy(false);
    }
  }

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
      showToast("Voice settings saved", 2500);
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
      showToast("Reverted to skill defaults", 2500);
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
          Voice &amp; recording
        </h2>
        <span className="text-xs text-muted-foreground">
          The tutor speaks in its persona&rsquo;s voice. These toggle what
          students can do; advanced voice tuning is below.
        </span>
      </header>

      {/* M4 — the essential surface: two plain on/off capabilities. */}
      <div className="divide-y divide-border rounded border border-border px-3">
        <SettingRow
          label="Student voice input"
          htmlFor="cap-voice-input"
          help="Let students talk-to-type (press the mic, speak, it fills the box)."
        >
          <input
            id="cap-voice-input"
            type="checkbox"
            checked={voiceInput}
            disabled={capBusy}
            onChange={(e) => void toggleCapability("voiceInput", e.target.checked)}
            className="h-5 w-5 accent-primary"
          />
        </SettingRow>
        <SettingRow
          label="Record this class"
          htmlFor="cap-recording"
          help="Capture the group's audio as a research record. Only enable if you hold signed consent forms for this class."
        >
          <input
            id="cap-recording"
            type="checkbox"
            checked={recording}
            disabled={capBusy}
            onChange={(e) => void toggleCapability("recording", e.target.checked)}
            className="h-5 w-5 accent-primary"
          />
        </SettingRow>
      </div>

      {/* M4 — the raw tier/voice picker is now ADVANCED (default collapsed).
          Personas are the primary way to choose a voice; this is the override. */}
      <AdvancedDisclosure label="Custom voice (advanced)">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
      </AdvancedDisclosure>
    </section>
  );
}
