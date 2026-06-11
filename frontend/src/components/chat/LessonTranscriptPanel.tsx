"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, FileText, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { fetchMyTranscript, type GroupTranscript } from "@/lib/transcriptApi";

const POLL_MS = 30_000;

/**
 * The student's own group's lesson transcript (REC-TRANSCRIPT M3). HIDDEN by
 * default — a "Lesson transcript" toggle reveals it. While open it polls the
 * group transcript (~30s) so it grows ~live as the recording is transcribed
 * segment-by-segment. Tied to the historic groupId server-side (/me/transcript).
 *
 * Only mount this when the class has recording enabled — there's no transcript
 * otherwise.
 */
export function LessonTranscriptPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<GroupTranscript | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const t = await fetchMyTranscript();
    setData(t);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    timerRef.current = setInterval(() => void load(), POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [open, load]);

  const hasText = !!data?.text?.trim();

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} aria-hidden="true" />
        <FileText className="h-4 w-4" aria-hidden="true" />
        Lesson transcript
        {open && loading ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div className="max-h-60 overflow-y-auto border-t border-border p-3 text-sm">
          {hasText ? (
            <p className="whitespace-pre-wrap leading-relaxed text-foreground">{data!.text}</p>
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
