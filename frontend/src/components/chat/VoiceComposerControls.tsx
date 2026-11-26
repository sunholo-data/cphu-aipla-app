"use client";

import { useCallback, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { fetchWithAuth } from "@/lib/apiClient";
import { AudioRecorder, isAudioCaptureSupported, type DictationCapture, type SegmentedRecorder } from "@/lib/audioCapture";
import { RecordingLevelMeter } from "./RecordingLevelMeter";

type Mode = "idle" | "dictating";

interface Props {
  skillId: string;
  /** BCP-47 short lang for STT (matches the read-aloud language). */
  lang: string;
  /** caps.voiceInput AND a real STT provider — talk-to-type. */
  voiceInputEnabled: boolean;
  /** chat is mid-turn — don't start dictation. */
  disabled?: boolean;
  /** A lesson recording that is running. Dictation then reads ITS audio
   * instead of opening a second mic stream (2026-11-23 feedback). */
  lessonRecorder?: SegmentedRecorder | null;
  /** Dictation started / ended on its OWN mic stream, so the parent can hold
   * off a lesson recording until it ends (one getUserMedia at a time). */
  onOwnMicChange?: (live: boolean) => void;
  /** dictation transcript -> fills the composer input. */
  onTranscript: (text: string) => void;
  /** soft status line (errors / "saved"). */
  onNotice?: (msg: string | null) => void;
}

/**
 * The composer mic (VOICE-IN-REC M3). Talk-to-type only: dictation -> STT ->
 * composer input. "Record this class" lives with its transcript in
 * `LessonRecordingPanel`. Only one getUserMedia stream is ever live: while a
 * lesson records, dictation taps the recording's audio (`lessonRecorder.tap()`)
 * instead of opening its own — until 2026-11-23 it was simply disabled, and a
 * group recording its talk could not talk to type. Renders nothing when voice
 * input is off or the device can't capture audio.
 */
export function VoiceComposerControls({
  skillId,
  lang,
  voiceInputEnabled,
  disabled,
  lessonRecorder,
  onOwnMicChange,
  onTranscript,
  onNotice,
}: Props) {
  const t = useT("VoiceComposerControls");
  const dictRef = useRef<DictationCapture | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);

  const begin = useCallback(async () => {
    onNotice?.(null);
    try {
      const shared = lessonRecorder?.recording ? lessonRecorder.tap() : null;
      if (shared) {
        dictRef.current = shared;
      } else {
        const own = new AudioRecorder();
        await own.start();
        dictRef.current = own;
        onOwnMicChange?.(true);
      }
      setMode("dictating");
    } catch {
      onNotice?.(t("micUnavailable"));
    }
  }, [lessonRecorder, onNotice, onOwnMicChange, t]);

  const finishDictation = useCallback(async () => {
    const capture = dictRef.current;
    if (!capture) return;
    setBusy(true);
    try {
      const own = capture instanceof AudioRecorder;
      const { blob, durationMs } = await capture.stop();
      dictRef.current = null;
      if (own) onOwnMicChange?.(false);
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
      else onNotice?.(t("noSpeech"));
    } catch {
      onNotice?.(t("transcribeFailed"));
    } finally {
      setBusy(false);
    }
  }, [lang, skillId, onOwnMicChange, onTranscript, onNotice, t]);

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
          aria-label={t("stopDictation")}
          title={t("stopDictation")}
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
      aria-label={t("talkToType")}
      title={t("talkToType")}
      className={iconBtn}
    >
      <Mic className="h-4 w-4" />
    </button>
  );
}
