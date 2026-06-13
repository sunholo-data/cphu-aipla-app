"use client";

import { useCallback, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import { fetchWithAuth } from "@/lib/apiClient";
import { AudioRecorder, isAudioCaptureSupported } from "@/lib/audioCapture";
import { RecordingLevelMeter } from "./RecordingLevelMeter";

type Mode = "idle" | "dictating";

interface Props {
  skillId: string;
  /** BCP-47 short lang for STT (matches the read-aloud language). */
  lang: string;
  /** caps.voiceInput AND a real STT provider — talk-to-type. */
  voiceInputEnabled: boolean;
  /** chat is mid-turn (or a lesson recording holds the mic) — don't start
   * dictation. */
  disabled?: boolean;
  /** dictation transcript -> fills the composer input. */
  onTranscript: (text: string) => void;
  /** soft status line (errors / "saved"). */
  onNotice?: (msg: string | null) => void;
}

/**
 * The composer mic (VOICE-IN-REC M3). Talk-to-type only: dictation -> STT ->
 * composer input. "Record this class" lives with its transcript in
 * `LessonRecordingPanel` — keeping the two mic uses in separate surfaces means
 * the parent can ensure only one getUserMedia stream is live at a time (it
 * disables this control while a lesson recording is running). Renders nothing
 * when voice input is off or the device can't capture audio.
 */
export function VoiceComposerControls({
  skillId,
  lang,
  voiceInputEnabled,
  disabled,
  onTranscript,
  onNotice,
}: Props) {
  const dictRef = useRef<AudioRecorder | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);

  const begin = useCallback(async () => {
    onNotice?.(null);
    try {
      dictRef.current ??= new AudioRecorder();
      await dictRef.current.start();
      setMode("dictating");
    } catch {
      onNotice?.("Microphone unavailable — you can type instead.");
    }
  }, [onNotice]);

  const finishDictation = useCallback(async () => {
    setBusy(true);
    try {
      const { blob, durationMs } = await (dictRef.current ??= new AudioRecorder()).stop();
      setMode("idle");
      const fd = new FormData();
      fd.append("audio", blob, "dictation.wav");
      fd.append("lang", lang);
      fd.append("skillId", skillId);
      fd.append("durationMs", String(durationMs));
      const res = await fetchWithAuth("/api/proxy/api/voice/stt/transcribe", { method: "POST", body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { text?: string };
      if (data.text?.trim()) onTranscript(data.text.trim());
      else onNotice?.("Didn't catch that — try again, or type.");
    } catch {
      onNotice?.("Couldn't transcribe — you can type instead.");
    } finally {
      setBusy(false);
    }
  }, [lang, skillId, onTranscript, onNotice]);

  const supported = isAudioCaptureSupported();
  const showDictate = voiceInputEnabled && supported;
  if (!showDictate) return null;

  const iconBtn = "rounded-md border px-2 py-2 text-muted-foreground hover:text-foreground disabled:opacity-40";

  if (mode === "dictating") {
    return (
      <div className="inline-flex items-center gap-1.5 text-red-600">
        {!busy && <RecordingLevelMeter getLevel={() => dictRef.current?.getLevel() ?? 0} />}
        <button
          type="button"
          onClick={() => void finishDictation()}
          disabled={busy}
          aria-label="Stop dictation"
          title="Stop dictation"
          className={cn(iconBtn, "border-red-400 text-red-600")}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
        </button>
      </div>
    );
  }

  // idle
  return (
    <button
      type="button"
      onClick={() => void begin()}
      disabled={disabled || busy}
      aria-label="Talk to type"
      title="Talk to type"
      className={iconBtn}
    >
      <Mic className="h-4 w-4" />
    </button>
  );
}
