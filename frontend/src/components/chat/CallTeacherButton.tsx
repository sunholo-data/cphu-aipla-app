"use client";

/**
 * CallTeacherButton (1.1.29) — a student escalates to a human teacher.
 *
 * A signal, not a message thread: tapping raises the group's hand; the teacher
 * sees it on their live class view. States (Axiom 11):
 *   resting   → "Tilkald lærer"        (tap to call)
 *   raised    → "Hånden er rakt op"     (tap again to lower)
 *   acknowledged → "Læreren er på vej"  (teacher cleared it; brief, then resting)
 *
 * Student-only: the caller gates rendering on anonymous-group auth. Writes use
 * the group token (see signalApi). Reconciles via a light poll so a teacher
 * acknowledgement shows up on the student side.
 */

import { Hand } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getGroupSignal, lowerHand, raiseHand } from "@/lib/signalApi";

type Props = {
  activityTitle?: string;
  disabled?: boolean;
  pollMs?: number;
};

export function CallTeacherButton({ activityTitle = "", disabled = false, pollMs = 10_000 }: Props) {
  const [raised, setRaised] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const wasRaised = useRef(false);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const s = await getGroupSignal();
        if (!alive) return;
        setRaised(s.raised);
        // A hand that was up is now down, cleared by someone other than the
        // student → the teacher acknowledged it.
        if (wasRaised.current && !s.raised && s.clearedBy && s.clearedBy !== "student") {
          setAcknowledged(true);
          window.setTimeout(() => {
            if (alive) setAcknowledged(false);
          }, 4000);
        }
        wasRaised.current = s.raised;
      } catch {
        // Transient — keep the last known state; next poll reconciles.
      }
    }
    void poll();
    const id = window.setInterval(() => void poll(), pollMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [pollMs]);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      if (raised) {
        await lowerHand();
        setRaised(false);
        wasRaised.current = false;
      } else {
        setAcknowledged(false);
        await raiseHand(activityTitle);
        setRaised(true);
        wasRaised.current = true;
      }
    } catch {
      // Optimistic state reverts on the next poll.
    } finally {
      setBusy(false);
    }
  }

  const label = acknowledged ? "Læreren er på vej" : raised ? "Hånden er rakt op" : "Tilkald lærer";
  const tone = raised
    ? "border-amber-500 bg-amber-50 text-amber-700"
    : acknowledged
      ? "border-green-600 bg-green-50 text-green-700"
      : "text-muted-foreground";

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={disabled || busy}
      aria-pressed={raised}
      title={label}
      data-testid="call-teacher-button"
      className={`flex items-center gap-1 rounded-md border px-2 py-2 text-sm disabled:opacity-50 ${tone}`}
    >
      <Hand className="h-4 w-4" aria-hidden />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </button>
  );
}
