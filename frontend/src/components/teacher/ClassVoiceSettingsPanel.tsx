"use client";

/**
 * 1.1.11 — Voice settings panel for the teacher's class-detail page.
 *
 * Two capability toggles (voice input, recording), plus a one-way escape hatch
 * for classes carrying a legacy per-class voice override.
 *
 * 2026-08-14 — the custom language/voice PICKER was removed to keep the class
 * screen simple. The tutor's voice comes from its persona, which is already
 * where a teacher chooses how the tutor sounds; a second, lower-level override
 * on a different screen only gave two answers to one question.
 *
 * Server-side resolution order is unchanged:
 *   student localStorage > per-class override > skill default > env
 *
 * The per-class slot still EXISTS in that chain, which is exactly why removing
 * the picker is not the whole job: an override saved before today keeps winning
 * over the persona, invisibly. Hence the clear-only affordance below. Once no
 * class carries one, it never renders.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { useToast } from "@/hooks/useToast";
import { CircleDot, Loader2, Mic, ShieldCheck, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  type ClassVoiceSettingsPayload,
  setClassCapabilities,
  setClassVoiceSettings,
} from "@/lib/teacherApi";
import { cn } from "@/lib/utils";

interface Props {
  classId: string;
  initial: ClassVoiceSettingsPayload | null | undefined;
  /** VOICE-IN-REC M4 — current per-class capability toggles. */
  initialVoiceInput?: boolean;
  initialRecording?: boolean;
  onSaved: () => void;
}

export function ClassVoiceSettingsPanel({
  classId,
  initial,
  initialVoiceInput = false,
  initialRecording = false,
  onSaved,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useToast();
  // Local, so the notice disappears the moment the clear succeeds rather than
  // waiting for the parent's refetch to land.
  const [cleared, setCleared] = useState(false);
  const hasVoiceOverride =
    !cleared && Boolean(initial?.language || initial?.voice || initial?.provider);

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

  async function handleClear() {
    setSaving(true);
    setError(null);
    try {
      await setClassVoiceSettings(classId, {
        language: null,
        voice: null,
        provider: null,
      });
      setCleared(true);
      showToast("Now using the persona's voice", 2500);
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
          what students can do in this class.
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

      {/* 2026-08-14 — the custom language/voice picker was REMOVED to keep the
          class screen simple. The tutor's voice comes from its persona, which
          is where a teacher already chooses how the tutor sounds; a second,
          lower-level override on a different screen only created two answers to
          one question. Note the server resolution order this sat in:
          student localStorage > per-class override > skill default > env.

          What is deliberately NOT removed: the escape hatch below. Deleting the
          picker does not delete overrides teachers already saved, and those
          keep winning over the persona — silently, with nothing on screen to
          explain why one class sounds different. So a class that HAS an
          override still says so, and can still clear it. Once the register is
          empty this block never renders again.

          The PUT endpoint and `setClassVoiceSettings` stay: this button is the
          only caller now, and re-adding a picker later needs no backend work. */}
      {hasVoiceOverride ? (
        <div className="flex flex-col gap-2 rounded border border-dashed border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">
            This class has an older <strong className="font-medium">custom voice</strong>{" "}
            saved
            {initial?.voice ? (
              <>
                {" "}
                (<code className="rounded bg-muted px-1">{initial.voice}</code>)
              </>
            ) : null}
            , which overrides the persona&rsquo;s own voice. Per-class voice
            overrides are no longer editable here — clear it to let the persona
            decide.
          </p>
          <button
            type="button"
            onClick={handleClear}
            disabled={saving}
            className="inline-flex w-fit items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <X className="h-4 w-4" aria-hidden="true" />
            )}
            Use the persona&rsquo;s voice
          </button>
        </div>
      ) : null}
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
