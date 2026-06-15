"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, FileText, Loader2, Radio, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import { fetchWithAuth } from "@/lib/apiClient";
import { fetchMyTranscript, type GroupTranscript } from "@/lib/transcriptApi";
import { SegmentedRecorder, isAudioCaptureSupported, type RecordingResult } from "@/lib/audioCapture";
import { RecordingLevelMeter } from "./RecordingLevelMeter";
import { TranscriptRows } from "./TranscriptRows";

const POLL_MS = 30_000;

interface Props {
  /** BCP-47 short lang for STT (matches the read-aloud language). */
  lang: string;
  /** chat is mid-turn — don't start new capture. */
  disabled?: boolean;
  /** report recording on/off so the parent can block dictation while we hold
   * the mic (one getUserMedia stream at a time). */
  onRecordingChange?: (recording: boolean) => void;
  /** soft status line (errors / "saved"). */
  onNotice?: (msg: string | null) => void;
}

/**
 * LessonRecordingPanel (REC-TRANSCRIPT M2/M3, integrated) — "record this class"
 * and its transcript in ONE surface. Mount it only when the class has recording
 * enabled; the record control and the transcript are never shown independently.
 *
 * The transcript body auto-expands the moment there's text to read (and can be
 * toggled manually after that). It polls while recording so it grows ~live as
 * each segment is transcribed, and refreshes right after a segment lands.
 *
 * Recording fails safe: the audio is the research record and is kept regardless
 * of whether STT produces text, so an empty transcript just means "not
 * transcribed yet" (or STT disabled).
 */
export function LessonRecordingPanel({ lang, disabled, onRecordingChange, onNotice }: Props) {
  const segRef = useRef<SegmentedRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<GroupTranscript | null>(null);
  const [loading, setLoading] = useState(false);
  // null = follow the auto-expand rule (open iff there's text); true/false =
  // the student has manually overridden it.
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const t = await fetchMyTranscript();
    setData(t);
    setLoading(false);
  }, []);

  // Load once on mount so a pre-existing transcript surfaces (and auto-expands).
  useEffect(() => {
    void load();
  }, [load]);

  // While recording, poll so the transcript grows ~live segment-by-segment.
  useEffect(() => {
    if (!recording) return;
    timerRef.current = setInterval(() => void load(), POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [recording, load]);

  // Upload one lesson segment, then refresh the transcript. Fire-and-forget so a
  // single failed upload never stalls the rolling recording.
  const uploadSegment = useCallback(
    async (r: RecordingResult, seq: number) => {
      try {
        const fd = new FormData();
        fd.append("audio", r.blob, `lesson-${seq}.wav`);
        fd.append("durationMs", String(r.durationMs));
        fd.append("seq", String(seq));
        fd.append("lang", lang);
        const res = await fetchWithAuth("/api/proxy/api/voice/recording", { method: "POST", body: fd });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        void load();
      } catch {
        onNotice?.("A recording segment failed to upload — recording continues.");
      }
    },
    [lang, load, onNotice],
  );

  const start = useCallback(async () => {
    onNotice?.(null);
    try {
      segRef.current = new SegmentedRecorder((r, seq) => void uploadSegment(r, seq));
      await segRef.current.start();
      setRecording(true);
      onRecordingChange?.(true);
    } catch {
      onNotice?.("Microphone unavailable — recording couldn't start.");
    }
  }, [onNotice, onRecordingChange, uploadSegment]);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      // Flushes the final partial segment (which uploads via onSegment).
      await segRef.current?.stop();
      segRef.current = null;
      setRecording(false);
      onRecordingChange?.(false);
      onNotice?.("Lesson recording saved.");
      void load();
    } catch {
      onNotice?.("Couldn't finish the recording cleanly — some segments may be saved.");
    } finally {
      setBusy(false);
    }
  }, [load, onNotice, onRecordingChange]);

  if (!isAudioCaptureSupported()) return null;

  const hasText = !!data?.text?.trim();
  // Auto-expand once there's a transcript to read, but NOT while recording —
  // the live capture is the focus then, and a growing transcript is noise.
  // The transcript is for reviewing after the lesson, so it reveals on stop
  // (or for a pre-existing transcript on load). A manual toggle overrides this.
  const open = manualOpen ?? (hasText && !recording);

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setManualOpen(!open)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} aria-hidden="true" />
          <FileText className="h-4 w-4" aria-hidden="true" />
          Lesson transcript
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
        </button>

        {recording ? (
          <button
            type="button"
            onClick={() => void stop()}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
            Stop recording
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={disabled || busy}
            aria-label="Record this class"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            <Radio className="h-3.5 w-3.5" />
            Record this class
          </button>
        )}
      </div>

      {recording ? (
        <div className="flex items-center gap-2 border-t border-border bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
          <Radio className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
          <span className="font-medium">Recording this class…</span>
          <RecordingLevelMeter getLevel={() => segRef.current?.getLevel() ?? 0} className="ml-1" />
        </div>
      ) : null}

      {open ? (
        <div className="max-h-60 overflow-y-auto border-t border-border p-3 text-sm">
          {hasText ? (
            <TranscriptRows segments={data!.segments} />
          ) : (
            <p className="text-muted-foreground">
              No transcript yet — it appears about a minute after recording starts.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
