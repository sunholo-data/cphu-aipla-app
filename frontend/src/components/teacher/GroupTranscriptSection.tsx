"use client";

import { useEffect, useState } from "react";

import { fetchGroupTranscript, type GroupTranscript } from "@/lib/transcriptApi";
import { TranscriptRows } from "@/components/chat/TranscriptRows";

/**
 * The group's lesson-recording transcript on the teacher report (REC-TRANSCRIPT
 * M4). Renders nothing when the group has no transcript (recording wasn't
 * enabled/used), so it's invisible for non-recorded sessions. Shows one
 * timestamped row per recorded segment (TranscriptRows).
 */
export function GroupTranscriptSection({ groupId }: { groupId: string }) {
  const [data, setData] = useState<GroupTranscript | null | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    void fetchGroupTranscript(groupId).then((t) => {
      if (!cancelled) setData(t);
    });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  if (data === "loading" || !data || !data.text.trim()) return null;

  return (
    <section aria-labelledby="transcript-label" className="flex flex-col gap-2">
      <h2 id="transcript-label" className="text-base font-semibold">
        Lesson recording transcript
      </h2>
      <div className="max-h-80 overflow-y-auto rounded-md border border-border p-3 text-sm">
        <TranscriptRows segments={data.segments} />
      </div>
      <p className="text-xs text-muted-foreground">
        {data.segments.length} segment{data.segments.length === 1 ? "" : "s"} · transcribed from the
        recorded audio (research record, consent-gated).
      </p>
    </section>
  );
}
