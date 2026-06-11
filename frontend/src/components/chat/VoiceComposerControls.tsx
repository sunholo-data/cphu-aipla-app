"use client";

import { useCallback, useRef, useState } from "react";
import { Loader2, Mic, Radio, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import { fetchWithAuth } from "@/lib/apiClient";
import {
  AudioRecorder,
  SegmentedRecorder,
  isAudioCaptureSupported,
  type RecordingResult,
} from "@/lib/audioCapture";

type Mode = "idle" | "dictating" | "recording";

interface Props {
  skillId: string;
  /** BCP-47 short lang for STT (matches the read-aloud language). */
  lang: string;
  /** caps.voiceInput AND a real STT provider — talk-to-type. */
  voiceInputEnabled: boolean;
  /** caps.recording — "record this class". */
  recordingEnabled: boolean;
  /** chat is mid-turn — don't start new capture. */
  disabled?: boolean;
  /** dictation transcript -> fills the composer input. */
  onTranscript: (text: string) => void;
  /** soft status line (errors / "saved"). */
  onNotice?: (msg: string | null) => void;
}

/**
 * The composer mic (VOICE-IN-REC M3). One recorder, two mutually-exclusive
 * modes: talk-to-type (dictation -> STT -> input) XOR record-lesson (group
 * audio -> research store). Never two getUserMedia streams at once. Renders
 * nothing when neither capability is on or the device can't capture audio.
 */
export function VoiceComposerControls({
  skillId,
  lang,
  voiceInputEnabled,
  recordingEnabled,
  disabled,
  onTranscript,
  onNotice,
}: Props) {
  const dictRef = useRef<AudioRecorder | null>(null);
  const segRef = useRef<SegmentedRecorder | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);

  // Upload one lesson segment (REC-TRANSCRIPT M2). Fire-and-forget so it never
  // stalls the rolling recording; the backend transcribes it best-effort.
  const uploadSegment = useCallback(
    async (r: RecordingResult, seq: number) => {
      try {
        const fd = new FormData();
        fd.append("audio", r.blob, `lesson-${seq}.${r.mimeType.includes("mp4") ? "m4a" : "webm"}`);
        fd.append("durationMs", String(r.durationMs));
        fd.append("seq", String(seq));
        fd.append("lang", lang);
        const res = await fetchWithAuth("/api/proxy/api/voice/recording", { method: "POST", body: fd });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        onNotice?.("A recording segment failed to upload — recording continues.");
      }
    },
    [lang, onNotice],
  );

  const begin = useCallback(
    async (next: "dictating" | "recording") => {
      onNotice?.(null);
      try {
        if (next === "recording") {
          segRef.current = new SegmentedRecorder((r, seq) => void uploadSegment(r, seq));
          await segRef.current.start();
        } else {
          dictRef.current ??= new AudioRecorder();
          await dictRef.current.start();
        }
        setMode(next);
      } catch {
        onNotice?.("Microphone unavailable — you can type instead.");
      }
    },
    [onNotice, uploadSegment],
  );

  const finishDictation = useCallback(async () => {
    setBusy(true);
    try {
      const { blob, mimeType, durationMs } = await (dictRef.current ??= new AudioRecorder()).stop();
      setMode("idle");
      const fd = new FormData();
      fd.append("audio", blob, `dictation.${mimeType.includes("mp4") ? "m4a" : "webm"}`);
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

  const finishRecording = useCallback(async () => {
    setBusy(true);
    try {
      // Flushes the final partial segment (which uploads via onSegment).
      await segRef.current?.stop();
      segRef.current = null;
      setMode("idle");
      onNotice?.("Lesson recording saved.");
    } catch {
      onNotice?.("Couldn't finish the recording cleanly — some segments may be saved.");
    } finally {
      setBusy(false);
    }
  }, [onNotice]);

  const supported = isAudioCaptureSupported();
  const showDictate = voiceInputEnabled && supported;
  const showRecord = recordingEnabled && supported;
  if (!showDictate && !showRecord) return null;

  const iconBtn = "rounded-md border px-2 py-2 text-muted-foreground hover:text-foreground disabled:opacity-40";

  // Recording a lesson takes over the row with an explicit banner (Axiom 11 —
  // never an ambiguous always-listening state).
  if (mode === "recording") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        <Radio className="h-4 w-4 animate-pulse" />
        <span className="font-medium">Recording this class…</span>
        <button
          type="button"
          onClick={() => void finishRecording()}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
          Stop
        </button>
      </div>
    );
  }

  if (mode === "dictating") {
    return (
      <button
        type="button"
        onClick={() => void finishDictation()}
        disabled={busy}
        aria-label="Stop dictation"
        title="Stop dictation"
        className={cn(iconBtn, "border-red-400 text-red-600")}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4 animate-pulse" />}
      </button>
    );
  }

  // idle
  return (
    <>
      {showDictate && (
        <button
          type="button"
          onClick={() => void begin("dictating")}
          disabled={disabled || busy}
          aria-label="Talk to type"
          title="Talk to type"
          className={iconBtn}
        >
          <Mic className="h-4 w-4" />
        </button>
      )}
      {showRecord && (
        <button
          type="button"
          onClick={() => void begin("recording")}
          disabled={disabled || busy}
          aria-label="Record this class"
          title="Record this class"
          className={cn(iconBtn, "hidden sm:inline-flex")}
        >
          <Radio className="h-4 w-4" />
        </button>
      )}
    </>
  );
}
