"use client";

import { useEffect, useMemo, useRef } from "react";

import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";
import { useSimSnapshotPush } from "@/hooks/useSimSnapshotPush";
import { DEFAULT_LOCALE, useLocaleMode } from "@/i18n";
import { subscribeSimCommands, type SimCommand } from "@/lib/simCommandBus";

import { StaticArtefactFrame, type McpAppHostContext, type StaticArtefactFrameHandle } from "./StaticArtefactFrame";

// Host → artefact signal sent right before a student chat message goes out, so
// an artefact that buffers continuous input (e.g. Boldkast's commit-on-submit
// slider gating) flushes its pending state to the tutor for THIS turn. Mirrors
// the MCP-Apps notification the artefact already listens for. Artefacts that
// don't buffer simply ignore it.
const CHAT_FLUSH_NOTIFICATION = "ui/notifications/chat-flush";

// MCP Apps spec: host → view, a PARTIAL HostContext the view merges.
const HOST_CONTEXT_CHANGED_NOTIFICATION = "ui/notifications/host-context-changed";

// Upper bound the chat page waits for a flush to commit before sending the
// message anyway. A buffering artefact emits its pending state-change within a
// postMessage round-trip (a few ms), so we resolve as soon as the resulting
// push settles; this cap only bites when the artefact had nothing to flush (no
// push will ever come) — keeping send latency negligible in that common case.
const FLUSH_MAX_WAIT_MS = 150;

/** The resolved artefact the student-facing `/active` endpoint returns (the
 *  public catalogue view — never the `tutorBlock`). Mirrors `ArtefactMeta.public()`. */
export interface ActivityArtefact {
  id: string;
  displayName: string;
  artefactPath: string;
  topics?: string[];
  levels?: string[];
  language?: string;
  /** MOBILE-1 — narrowest viewport (CSS px) at which this sim is fully usable.
   *  Undefined means "works everywhere". Set from the backend artefact
   *  catalogue (`backend/artefacts/*.yaml`), never per activity. */
  minViewportPx?: number | null;
  status?: string;
}

interface GenericArtefactFrameProps {
  /** Sandbox origin (NO trailing /sandbox.html) — the mcp-sandbox service. */
  sandboxOrigin: string;
  artefact: ActivityArtefact;
  /** Active chat session id; when set, artefact events push to the tutor. */
  sessionId?: string | null;
  /** The hosting activity — stamped on the workbench event (1.1.136 M0). */
  activityId?: string;
  /** Registers a "flush pending state" callback the chat page awaits right
   *  before each outgoing student message (and `null` on unmount). Lets a
   *  buffering artefact commit its latest state to the tutor for that turn —
   *  the unified replacement for the old per-sim `sendChatFlush()` ref. The
   *  callback resolves once the flushed state's push has committed (or a short
   *  cap elapses), so the AI run reads the fresh state, not a stale snapshot. */
  onRegisterFlush?: (flush: (() => Promise<void>) | null) => void;
}

// Generic noise: events that update local artefact UI but aren't state worth
// pushing to the tutor. Matched by suffix so it works for ANY artefact's
// vocabulary (boldkast.pause / led-planck.reset / …).
const NOISE_SUFFIXES = [".pause", ".reset", "-error", ".sync"];
const isNoise = (kind: string): boolean => NOISE_SUFFIXES.some((s) => kind.endsWith(s));

// The human-readable label for the in-chat trust card ("Afspillede med
// v₀=15 m/s, θ=40°"): the student's visible confirmation that THIS action
// reached the tutor (pending → confirmed/failed). The artefact supplies the
// label in its `update-model-context` payload — it's self-contained and knows
// its own symbols/units/language. We fall back to a generic `key=value` summary
// of `state` so a card still renders for an artefact that hasn't adopted
// `label` yet. Returns null → no card (e.g. an `open` ping with nothing to show).
function cardLabel(sc: Record<string, unknown>): string | null {
  if (typeof sc.label === "string" && sc.label.trim()) return sc.label.trim();
  const state = sc.state;
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const parts = Object.entries(state as Record<string, unknown>)
      .filter(([, v]) => typeof v === "number" || typeof v === "string")
      .map(([k, v]) => `${k}=${v}`);
    if (parts.length) return parts.join(", ");
  }
  return null;
}

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
  activityId,
  onRegisterFlush,
}: GenericArtefactFrameProps) {
  const frameRef = useRef<StaticArtefactFrameHandle | null>(null);
  // 1.1.108 rule 5 — the supply side. A sim reads `locale` from the host context
  // it receives at ui/initialize; until this was passed, every sim fell back to
  // its own default. The locale is the ACTIVITY's (via the provider), never the
  // browser's. A sim cannot render two languages at once, so "bilingual" (no
  // single activity known) resolves to the platform default.
  const localeMode = useLocaleMode();
  const hostContext = useMemo<McpAppHostContext>(
    () => ({
      displayMode: "inline",
      locale: localeMode === "bilingual" ? DEFAULT_LOCALE : localeMode,
      timeZone: "Europe/Copenhagen",
    }),
    [localeMode],
  );
  // The sim reads `locale` once, at the ui/initialize handshake. A later change
  // (a student switching DA/EN mid-session) reaches a RUNNING sim through the
  // MCP-Apps `host-context-changed` notification — partial, merged by the view —
  // never through a remount, which would throw away the sim's state. A sim that
  // does not listen simply picks the new locale up on its next load.
  const sentLocaleRef = useRef(hostContext.locale);
  useEffect(() => {
    if (sentLocaleRef.current === hostContext.locale) return;
    sentLocaleRef.current = hostContext.locale;
    frameRef.current?.sendNotification(HOST_CONTEXT_CHANGED_NOTIFICATION, { locale: hostContext.locale });
  }, [hostContext.locale]);
  // 1.1.133 M1 — tutor → sim. A `control_sim` call published by the chat card
  // arrives here and goes to the sim as the host notification
  // `<id>.cmd-<command>` over the same bridge as chat-flush. Commands that
  // arrive before the sim has finished its ui/initialize handshake are held and
  // sent once it has (a postMessage before then reaches no listener). The sim's
  // resulting state comes back the normal way, on its next commit / flush.
  const simReadyRef = useRef(false);
  const heldCommandsRef = useRef<SimCommand[]>([]);
  useEffect(() => {
    const send = (c: SimCommand) => frameRef.current?.sendNotification(`${artefact.id}.cmd-${c.command}`, c.args);
    return subscribeSimCommands(artefact.id, (c) => {
      if (simReadyRef.current) send(c);
      else heldCommandsRef.current.push(c);
    });
  }, [artefact.id]);
  const handleInitialized = () => {
    simReadyRef.current = true;
    const held = heldCommandsRef.current;
    heldCommandsRef.current = [];
    held.forEach((c) => frameRef.current?.sendNotification(`${artefact.id}.cmd-${c.command}`, c.args));
  };
  const pushSnapshot = useSimSnapshotPush<Record<string, unknown>>(sessionId ?? null, artefact.id);
  // Trust-card dispatcher. No-op fallback when rendered outside a
  // HumanToolEventsProvider (the builder preview), so this stays safe there.
  const humanToolEvents = useHumanToolEvents();
  // Set while a flush is awaiting its resulting push. `handleStructuredContent`
  // settles it with the push promise so the chat page's `await flush()` resolves
  // only once the flushed state has actually committed to the backend.
  const flushAwaitRef = useRef<((push: Promise<Response> | null) => void) | null>(null);

  // Hand the chat page an awaitable "flush before send" hook. The returned
  // promise resolves once the artefact's flushed state-change has committed
  // (its iframe-context POST settled), or after a short cap when the artefact
  // had nothing pending — so the AI run reads fresh state, not a stale snapshot.
  useEffect(() => {
    if (!onRegisterFlush) return;
    onRegisterFlush(
      () =>
        new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            flushAwaitRef.current = null;
            resolve();
          };
          const timer = setTimeout(finish, FLUSH_MAX_WAIT_MS);
          // Called by handleStructuredContent with the post-flush push (or null);
          // await its completion, then resolve. Cancels the cap timer.
          flushAwaitRef.current = (push) => {
            clearTimeout(timer);
            if (push) void push.finally(finish);
            else finish();
          };
          frameRef.current?.sendNotification(CHAT_FLUSH_NOTIFICATION, {});
        }),
    );
    return () => onRegisterFlush(null);
  }, [onRegisterFlush]);

  const handleStructuredContent = (sc: Record<string, unknown>) => {
    const kind = typeof sc.kind === "string" ? sc.kind : "";
    if (!kind || isNoise(kind)) return;
    const label = cardLabel(sc);
    // Pass the label through so the backend persists it on the iframe-context
    // state_delta — the chat transcript re-renders the same card on reload.
    // 1.1.136 M0 — a label-less event (an artefact with no `label`, no scalar
    // state) is still named in the log: the sim's name and the event kind are
    // data, not copy, so they need no translation.
    const req = pushSnapshot(sc, kind, label, {
      logLabel: label ?? `${artefact.displayName || artefact.id} · ${kind}`,
      activityId,
    });
    // If a flush is awaiting, hand it THIS push so it resolves on commit.
    const awaiting = flushAwaitRef.current;
    if (awaiting) {
      flushAwaitRef.current = null;
      awaiting(req);
    }
    if (req) {
      // Render the in-chat trust card (pending → confirmed/failed) so the
      // student SEES what reached the tutor — the affordance the bespoke sim
      // frames had before USR-1 unified them. Same push promise drives both
      // the card status and the catch below; only when there's a label.
      if (label) humanToolEvents.dispatch({ label, push: () => req });
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
        hostContext={hostContext}
        onUpdateModelContext={handleStructuredContent}
        onInitialized={handleInitialized}
        title={artefact.displayName}
        className="w-full min-h-[700px] border-0"
      />
    </div>
  );
}
