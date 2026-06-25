"use client";

import { useEffect, useRef } from "react";

import { useSimSnapshotPush } from "@/hooks/useSimSnapshotPush";

import { StaticArtefactFrame, type StaticArtefactFrameHandle } from "./StaticArtefactFrame";

// Host → artefact signal sent right before a student chat message goes out, so
// an artefact that buffers continuous input (e.g. Boldkast's commit-on-submit
// slider gating) flushes its pending state to the tutor for THIS turn. Mirrors
// the MCP-Apps notification the artefact already listens for. Artefacts that
// don't buffer simply ignore it.
const CHAT_FLUSH_NOTIFICATION = "ui/notifications/chat-flush";

/** The resolved artefact the student-facing `/active` endpoint returns (the
 *  public catalogue view — never the `tutorBlock`). Mirrors `ArtefactMeta.public()`. */
export interface ActivityArtefact {
  id: string;
  displayName: string;
  artefactPath: string;
  topics?: string[];
  levels?: string[];
  language?: string;
  status?: string;
}

interface GenericArtefactFrameProps {
  /** Sandbox origin (NO trailing /sandbox.html) — the mcp-sandbox service. */
  sandboxOrigin: string;
  artefact: ActivityArtefact;
  /** Active chat session id; when set, artefact events push to the tutor. */
  sessionId?: string | null;
  /** Registers a "flush pending state" callback the chat page invokes right
   *  before each outgoing student message (and `null` on unmount). Lets a
   *  buffering artefact commit its latest state to the tutor for that turn —
   *  the unified replacement for the old per-sim `sendChatFlush()` ref. */
  onRegisterFlush?: (flush: (() => void) | null) => void;
}

// Generic noise: events that update local artefact UI but aren't state worth
// pushing to the tutor. Matched by suffix so it works for ANY artefact's
// vocabulary (boldkast.pause / led-planck.reset / …).
const NOISE_SUFFIXES = [".pause", ".reset", "-error", ".sync"];
const isNoise = (kind: string): boolean => NOISE_SUFFIXES.some((s) => kind.endsWith(s));

/**
 * GenericArtefactFrame — mounts ANY catalogued artefact (1.1.41 M1) in the
 * student workspace, keyed by `artefactPath`, with no per-sim code. Unlike the
 * bespoke per-sim frames (which narrow each event to a typed payload), the
 * generic path forwards the **full** `structuredContent` to the tutor via the
 * `iframe-context` wire (serverId = the artefact id, so the tutor sees
 * `mcp_app_context.<id>.state`). The proactive gate inside `useSimSnapshotPush`
 * decides which event kinds fire a tutor turn — already artefact-agnostic.
 */
export function GenericArtefactFrame({
  sandboxOrigin,
  artefact,
  sessionId,
  onRegisterFlush,
}: GenericArtefactFrameProps) {
  const frameRef = useRef<StaticArtefactFrameHandle | null>(null);
  const pushSnapshot = useSimSnapshotPush<Record<string, unknown>>(sessionId ?? null, artefact.id);

  // Hand the chat page a "flush before send" hook. Fire-and-forget: the
  // notification is a postMessage to the artefact, which (if it buffers) emits
  // its pending state-change synchronously in-frame so the resulting
  // iframe-context POST lands ahead of the chat turn in practice.
  useEffect(() => {
    if (!onRegisterFlush) return;
    onRegisterFlush(() => {
      frameRef.current?.sendNotification(CHAT_FLUSH_NOTIFICATION, {});
    });
    return () => onRegisterFlush(null);
  }, [onRegisterFlush]);

  const handleStructuredContent = (sc: Record<string, unknown>) => {
    const kind = typeof sc.kind === "string" ? sc.kind : "";
    if (!kind || isNoise(kind)) return;
    const req = pushSnapshot(sc, kind);
    if (req) {
      void req.catch((err) => {
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn("[artefact] iframe-context push failed:", err);
        }
      });
    }
  };

  return (
    <div className="flex min-h-0 flex-col bg-background" aria-label={artefact.displayName}>
      <StaticArtefactFrame
        ref={frameRef}
        sandboxOrigin={sandboxOrigin}
        artefactPath={artefact.artefactPath}
        onUpdateModelContext={handleStructuredContent}
        title={artefact.displayName}
        className="w-full min-h-[700px] border-0"
      />
    </div>
  );
}
