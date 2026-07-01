"use client";

import { useEffect, useRef, useState } from "react";
import { fetchWithAuth } from "@/lib/apiClient";
import { isAnonymousGroupAuthMode } from "@/lib/anonymousGroupAuth";

/** Live pulse for a group's shared session (1.1.53 M1).
 *
 * `revision` is a monotone counter that bumps each time a turn commits — a
 * watcher device refetches `/messages` when it grows, so a groupmate's turn
 * appears live. `turnInFlight` is the (TTL-aware) turn-lock: true while SOME
 * member's turn is streaming, which the composer uses to show "a classmate is
 * asking the tutor…" and queue the local message. */
export interface GroupPulse {
  revision: number;
  turnInFlight: boolean;
  /** 1.1.53 M3 — how many devices are on this (group, activity) right now. A
   *  count, never identities. 0 until the first poll resolves. */
  activeDevices: number;
}

const IDLE: GroupPulse = { revision: 0, turnInFlight: false, activeDevices: 0 };

/** An ephemeral per-tab device token for presence — random, not a student
 *  identity (single group voice). Regenerated per tab load; that's the unit we
 *  count as "a device here". */
function makeDeviceToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `dev-${Math.floor(performance.now())}-${Date.now()}`;
  }
}

/** Poll `GET /api/auth/group/pulse` while the tab is visible.
 *
 * Reuses the platform's poll-while-active live idiom (zero LLM, no websockets —
 * cf. the teacher live-group drill-down). Backs off entirely when the tab is
 * hidden and refreshes promptly on re-focus. Only runs for anonymous-group
 * students (the shared-session case); returns IDLE otherwise. */
export function useGroupPulse(
  activityId: string | null,
  opts?: { enabled?: boolean; intervalMs?: number },
): GroupPulse {
  const enabled = opts?.enabled ?? isAnonymousGroupAuthMode();
  const intervalMs = opts?.intervalMs ?? 2500;
  const [pulse, setPulse] = useState<GroupPulse>(IDLE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable per-tab device token for the presence heartbeat (M3).
  const deviceRef = useRef<string>("");
  if (!deviceRef.current) deviceRef.current = makeDeviceToken();

  useEffect(() => {
    if (!enabled) {
      setPulse(IDLE);
      return;
    }
    let cancelled = false;
    let controller: AbortController | null = null;

    const clearTimer = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    const schedule = () => {
      clearTimer();
      timer.current = setTimeout(tick, intervalMs);
    };

    async function tick() {
      // Don't poll a backgrounded tab — the group's shared session isn't moving
      // on this screen, and a re-focus (below) refreshes immediately.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        schedule();
        return;
      }
      controller?.abort();
      controller = new AbortController();
      try {
        const params = new URLSearchParams();
        if (activityId) params.set("activityId", activityId);
        params.set("device", deviceRef.current);
        const res = await fetchWithAuth(`/api/proxy/api/auth/group/pulse?${params.toString()}`, {
          signal: controller.signal,
        });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as {
            revision?: number;
            turnInFlight?: boolean;
            activeDevices?: number;
          };
          setPulse({
            revision: Number(data.revision) || 0,
            turnInFlight: Boolean(data.turnInFlight),
            activeDevices: Number(data.activeDevices) || 0,
          });
        }
      } catch {
        // Transient (network/abort) — keep the last known pulse and retry.
      } finally {
        if (!cancelled) schedule();
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !cancelled) tick();
    };

    tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      controller?.abort();
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, activityId, intervalMs]);

  return pulse;
}
