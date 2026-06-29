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
import type { ReactNode } from "react";
import { useToast } from "@/hooks/useToast";
import { CircleDot, Loader2, Mic, Save, ShieldCheck, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  type ClassVoiceSettingsPayload,
  type VoiceListEntry,
  type VoiceListResponse,
  fetchVoiceList,
  setClassCapabilities,
  setClassVoiceSettings,
} from "@/lib/teacherApi";
import { AdvancedDisclosure } from "@/components/teacher/ui";
import { cn } from "@/lib/utils";

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
      <header className="flex flex-col gap-1">
        <h2 id="voice-settings-label" className="text-lg font-semibold">
          Voice &amp; recording
        </h2>
        <p className="text-xs text-muted-foreground">
          The tutor speaks in its persona&rsquo;s voice. These two switches set
          what students can do in this class; advanced voice tuning is below.
        </p>
      </header>

      {/* M4 — the essential surface: two prominent on/off capabilities rendered
          as toggle-switch cards. The raw tier/voice picker is demoted below. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <CapabilityToggleCard
          id="cap-voice-input"
          icon={Mic}
          label="Student voice input"
          help="Let students talk-to-type — press the mic, speak, and it fills the box."
          checked={voiceInput}
          disabled={capBusy}
          onChange={(next) => void toggleCapability("voiceInput", next)}
        />
        <CapabilityToggleCard
          id="cap-recording"
          icon={CircleDot}
          tone="warning"
          label="Record this class"
          help="Capture the group's audio as a research record."
          checked={recording}
          disabled={capBusy}
          onChange={(next) => void toggleCapability("recording", next)}
          footer={
            <span
              className={cn(
                "flex items-start gap-1.5 text-xs",
                recording ? "text-amber-700" : "text-muted-foreground",
              )}
            >
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {recording
                ? "Recording on — only keep this enabled while you hold signed consent for every participant."
                : "Only enable if you hold signed consent forms for this class."}
            </span>
          }
        />
      </div>

      {/* Shared status line — covers both the toggle saves and the advanced save. */}
      {toast || error ? (
        <p
          role="status"
          className={cn("text-xs", error ? "text-red-600" : "text-emerald-600")}
        >
          {error ?? toast}
        </p>
      ) : null}

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
        </div>
      </div>
      </AdvancedDisclosure>
    </section>
  );
}

/**
 * A prominent on/off capability rendered as a toggle-switch card — the primary
 * surface for "what students can do in this class". `tone="warning"` tints the
 * card amber when on (used for recording, which carries a consent obligation).
 * Keeps a real `<input type="checkbox">` under the hood for a11y + tests.
 */
function CapabilityToggleCard({
  id,
  icon: Icon,
  label,
  help,
  checked,
  disabled,
  onChange,
  tone = "primary",
  footer,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  tone?: "primary" | "warning";
  footer?: ReactNode;
}) {
  const warn = tone === "warning";
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4 transition-colors",
        checked
          ? warn
            ? "border-amber-400/60 bg-amber-50"
            : "border-primary/40 bg-primary/[0.04]"
          : "border-border bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
              checked
                ? warn
                  ? "bg-amber-100 text-amber-700"
                  : "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-foreground">{label}</span>
            <span className="text-xs text-muted-foreground">{help}</span>
          </div>
        </div>
        <ToggleSwitch
          id={id}
          label={label}
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          warn={warn}
        />
      </div>
      {footer ? <div className="pl-12">{footer}</div> : null}
    </div>
  );
}

/**
 * Styled toggle switch backed by a visually-hidden real checkbox, so it stays
 * keyboard-operable and addressable by `getByLabelText` in tests.
 */
function ToggleSwitch({
  id,
  label,
  checked,
  disabled,
  onChange,
  warn,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  warn?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "h-6 w-11 rounded-full bg-muted-foreground/30 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1",
          checked && (warn ? "bg-amber-500" : "bg-primary"),
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </label>
  );
}
