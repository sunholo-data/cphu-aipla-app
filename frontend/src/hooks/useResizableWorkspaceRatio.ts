"use client";

import { useCallback, useEffect, useState } from "react";

/** Resize allowed range. 0.30 = chat takes 70%; 1.00 = chat hidden. */
export const RATIO_MIN = 0.3;
export const RATIO_MAX = 1.0;

/** Per-skill default workspace ratio. Skills not listed fall through to
 *  RATIO_DEFAULT. Hardcoded for v0.1 — the SkillConfig schema field
 *  (uiHints.defaultWorkspaceRatio) is a v1.1 open question per the
 *  resizable-workspace design doc. */
export const DEFAULT_RATIOS: Record<string, number> = {
  "problem-set-hints": 0.5, // Boldkast: single canvas, fits comfortably
  "led-planck-tutor": 0.55, // LED Planck: bench wants a touch more room
  kinebot: 0.65, // KineBot: 7 sims + graph plotter need ~900px
};

export const RATIO_DEFAULT = 0.5;

const STORAGE_PREFIX = "aipla.workspaceRatio:";

function storageKey(skillId: string): string {
  return STORAGE_PREFIX + skillId;
}

function clampRatio(v: number): number {
  if (!Number.isFinite(v)) return RATIO_DEFAULT;
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, v));
}

/** Read a stored ratio for a skill. Returns null when nothing stored
 *  or the stored value is malformed / out of range. SSR-safe (returns
 *  null when window is undefined). */
export function readStoredRatio(skillId: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(skillId));
    if (raw === null) return null;
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) return null;
    if (parsed < RATIO_MIN || parsed > RATIO_MAX) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredRatio(skillId: string, ratio: number): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(skillId), String(ratio));
  } catch {
    // Quota / disabled storage — silently ignore. Resize still works in
    // memory; just doesn't survive the tab.
  }
}

function defaultRatioFor(skillId: string): number {
  return DEFAULT_RATIOS[skillId] ?? RATIO_DEFAULT;
}

export interface UseResizableWorkspaceRatio {
  ratio: number;
  setRatio: (next: number) => void;
}

/** Lifted state for the chat <-> workspace split ratio. Returns the
 *  current ratio (initialised from sessionStorage with a per-skill
 *  default fallback) plus a setter that persists on call.
 *
 *  Pattern note: initial state is RATIO_DEFAULT to avoid SSR
 *  divergence (no sessionStorage on the server). The real ratio
 *  loads in a useEffect on mount. There's a one-frame visual flash
 *  on hydrate which is acceptable for a workspace layout — the
 *  alternative is server-rendering the resize state, which is more
 *  cost than it's worth. */
export function useResizableWorkspaceRatio(
  skillId: string,
): UseResizableWorkspaceRatio {
  const [ratio, setRatioInternal] = useState<number>(
    () => defaultRatioFor(skillId),
  );

  useEffect(() => {
    const stored = readStoredRatio(skillId);
    setRatioInternal(stored ?? defaultRatioFor(skillId));
  }, [skillId]);

  const setRatio = useCallback(
    (next: number) => {
      const clamped = clampRatio(next);
      setRatioInternal(clamped);
      writeStoredRatio(skillId, clamped);
    },
    [skillId],
  );

  return { ratio, setRatio };
}
