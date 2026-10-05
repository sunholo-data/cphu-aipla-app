import type { SkillMessage } from "@/hooks/useSkillAgent";

/**
 * 1.1.145 M2 — one transcript out of two sources, for a group's shared session.
 *
 * Every device on a group code shares one conversation (ADR-001; 1.1.53), and
 * the tutor reads all of it. A device's screen has two sources for it:
 *
 *  - `history` — `GET /messages`, refetched on every pulse revision bump: the
 *    SAME events the model reads, including groupmates' turns;
 *  - `live` — this device's own AG-UI stream, which carries what history cannot
 *    (tool-call cards, the message id auto-read and the trust cards key on).
 *
 * 1.1.53 M1 refetched only for a device that had never sent anything, because
 * the two blocks rendered un-deduplicated. The moment a student spoke, they
 * stopped seeing their groupmates — and the tutor went on answering from
 * messages their screen never showed (V1, the 2026-10-05 seminar).
 *
 * The fold: walk `history` in order. A history message that IS this device's
 * next live message (same role, same text) renders as the live one, in history's
 * position; every other history message renders as itself. Live messages not yet
 * in history (the turn just sent, still persisting) follow at the end. So
 * groupmates' turns interleave in true order and nothing renders twice.
 *
 * `fromGroup` marks a user turn that arrived by a live refetch (index at or after
 * `syncedFrom`) and is not one of this device's — "sent from another device in
 * your group". No identity is needed for that, only "not mine".
 */

export type TranscriptItem =
  | { kind: "history"; message: SkillMessage; historyIndex: number; fromGroup: boolean }
  | { kind: "live"; message: SkillMessage; liveIndex: number; historyIndex: number | null };

/** Whitespace-insensitive text, so a turn persisted as several joined parts
 *  still matches the same text streamed as one. */
function norm(text: string): string {
  return text.replace(/\s+/g, "");
}

function sameTurn(h: SkillMessage, l: SkillMessage): boolean {
  if (h.role !== l.role) return false;
  const a = norm(h.content);
  const b = norm(l.content);
  if (!a || !b) return false;
  if (a === b) return true;
  // The persisted user turn can carry what the client added around the typed
  // text (e.g. an image part's placeholder). A long shared prefix is the same turn.
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return shorter.length >= 20 && longer.startsWith(shorter);
}

/** How far ahead in `live` a history message may match. A live message that is
 *  never persisted (an aborted run) must not strand every later one at the end. */
const LOOKAHEAD = 4;

export function buildSharedTranscript(
  history: SkillMessage[],
  live: SkillMessage[],
  syncedFrom: number,
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let p = 0; // next unmatched live message

  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    // Live messages with no text (a tool-only assistant turn) are never in
    // history — emit them where the stream put them.
    while (p < live.length && !norm(live[p].content)) {
      items.push({ kind: "live", message: live[p], liveIndex: p, historyIndex: null });
      p++;
    }
    let match = -1;
    // History loaded before this mount (index < syncedFrom) predates every live
    // message of this mount, so it never matches one — a student who types "ja"
    // twice across a reload must not have the new one folded onto the old.
    for (let q = p; i >= syncedFrom && q < Math.min(live.length, p + LOOKAHEAD); q++) {
      if (sameTurn(h, live[q])) {
        match = q;
        break;
      }
    }
    if (match >= 0) {
      // Anything skipped over was not persisted where expected; keep its place.
      for (let q = p; q < match; q++) {
        items.push({ kind: "live", message: live[q], liveIndex: q, historyIndex: null });
      }
      items.push({ kind: "live", message: live[match], liveIndex: match, historyIndex: i });
      p = match + 1;
    } else {
      items.push({
        kind: "history",
        message: h,
        historyIndex: i,
        fromGroup: h.role === "user" && i >= syncedFrom,
      });
    }
  }
  for (; p < live.length; p++) {
    items.push({ kind: "live", message: live[p], liveIndex: p, historyIndex: null });
  }
  return items;
}
