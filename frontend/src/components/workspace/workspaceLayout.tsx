"use client";

import { createContext, useCallback, useContext, useEffect, useRef } from "react";

import { RATIO_DEFAULT, RATIO_MAX } from "@/hooks/useResizableWorkspaceRatio";

/**
 * 1.1.140 M1 — the chat ↔ workspace split, handed DOWN to what the workspace
 * renders, so a sim can take the whole row ("focus mode") without the chat page
 * growing a new piece of state.
 *
 * The split already has a "chat hidden" value: ratio 1.0 (`RATIO_MAX`), which
 * the chat page turns into `md:hidden` on the chat column and `WorkspaceShell`
 * answers with a "Show chat" tab. Focus mode is that value, reached from the
 * sim's own header. `WorkspaceShell` provides this context only when it is
 * resizable; outside it (the teacher's builder preview) there is no context and
 * no focus control.
 */
export interface WorkspaceLayout {
  ratio: number;
  setRatio: (next: number) => void;
}

export const WorkspaceLayoutContext = createContext<WorkspaceLayout | null>(null);

export function useWorkspaceLayout(): WorkspaceLayout | null {
  return useContext(WorkspaceLayoutContext);
}

const FOCUS_PREFIX = "aipla.simFocus:";

function readFocusPref(key: string): boolean {
  try {
    return window.localStorage.getItem(FOCUS_PREFIX + key) === "1";
  } catch {
    return false; // storage blocked / private window — focus simply isn't remembered
  }
}

function writeFocusPref(key: string, on: boolean): void {
  try {
    window.localStorage.setItem(FOCUS_PREFIX + key, on ? "1" : "0");
  } catch {
    // Remembering is a convenience; the toggle still works in memory.
  }
}

export interface SimFocusMode {
  /** False outside a resizable workspace — render no control then. */
  available: boolean;
  /** The chat column is hidden and the sim has the row. */
  focused: boolean;
  toggle: () => void;
}

/**
 * Focus mode for an OPEN sim. Mount it where the sim is mounted: it applies
 * the remembered preference when the sim opens, and gives the student their
 * chat back when the sim closes (focus belongs to the sim, not to the page).
 *
 * `storageKey` is the activity — the preference is per activity, in
 * localStorage, because it is about the sim's layout rather than this tab.
 */
export function useSimFocusMode(storageKey: string): SimFocusMode {
  const layout = useWorkspaceLayout();
  const ratio = layout?.ratio ?? null;
  const setRatio = layout?.setRatio;
  // The split to return to when focus ends.
  const restoreRef = useRef<number>(RATIO_DEFAULT);
  // Did focus mode (not the student's own divider drag) hide the chat?
  const enteredRef = useRef(false);
  const latest = useRef({ ratio, setRatio });
  latest.current = { ratio, setRatio };
  // What the student SEES: the chat is hidden, however it got hidden.
  const focused = !!setRatio && ratio === RATIO_MAX;

  // On open: re-apply a remembered focus. On close: hand the chat back.
  useEffect(() => {
    const { ratio: r, setRatio: set } = latest.current;
    if (set && r !== null && readFocusPref(storageKey)) {
      if (r < RATIO_MAX) {
        restoreRef.current = r;
        enteredRef.current = true;
        set(RATIO_MAX);
      }
    }
    return () => {
      const { ratio: now, setRatio: setNow } = latest.current;
      if (enteredRef.current && setNow && now === RATIO_MAX) setNow(restoreRef.current);
      enteredRef.current = false;
    };
  }, [storageKey]);

  // The student brought the chat back another way ("Show chat" tab, divider):
  // focus has ended, and the next open should not re-hide it.
  // Only a TRANSITION out of the hidden state counts — on the render that
  // applies a remembered focus the ratio is still the old one.
  const prevRatioRef = useRef(ratio);
  useEffect(() => {
    const was = prevRatioRef.current;
    prevRatioRef.current = ratio;
    if (enteredRef.current && was === RATIO_MAX && ratio !== null && ratio < RATIO_MAX) {
      enteredRef.current = false;
      writeFocusPref(storageKey, false);
    }
  }, [ratio, storageKey]);

  const toggle = useCallback(() => {
    const { ratio: r, setRatio: set } = latest.current;
    if (!set || r === null) return;
    if (r === RATIO_MAX) {
      const back = enteredRef.current ? restoreRef.current : RATIO_DEFAULT;
      enteredRef.current = false;
      writeFocusPref(storageKey, false);
      set(back);
    } else {
      restoreRef.current = r;
      enteredRef.current = true;
      writeFocusPref(storageKey, true);
      set(RATIO_MAX);
    }
  }, [storageKey]);

  return { available: !!setRatio, focused, toggle };
}
