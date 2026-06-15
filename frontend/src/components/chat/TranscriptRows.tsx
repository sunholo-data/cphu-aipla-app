import type { TranscriptSegment } from "@/lib/transcriptApi";

/** Wall-clock HH:MM for a segment's createdAt (the time it was recorded), or
 *  "" when the timestamp is missing/unparseable (older segments). */
function segmentTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(d);
}

/**
 * Renders a lesson transcript as one row per recorded segment, each prefixed
 * with the time it was captured. Reads much better than a single joined blob —
 * a 45-minute recording becomes a scannable, timestamped log. Shared by the
 * student panel (LessonRecordingPanel) and the teacher report
 * (GroupTranscriptSection). Empty segments are dropped server-side, so every
 * row here has text.
 */
export function TranscriptRows({ segments }: { segments: TranscriptSegment[] }) {
  const rows = segments.filter((s) => s.text.trim()).sort((a, b) => a.seq - b.seq);
  if (rows.length === 0) return null;
  return (
    <ol className="flex flex-col gap-2">
      {rows.map((s) => {
        const t = segmentTime(s.createdAt);
        return (
          <li key={s.seq} className="flex gap-2.5">
            <span className="shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
              {t || `#${s.seq + 1}`}
            </span>
            <span className="whitespace-pre-wrap leading-relaxed text-foreground">{s.text.trim()}</span>
          </li>
        );
      })}
    </ol>
  );
}
