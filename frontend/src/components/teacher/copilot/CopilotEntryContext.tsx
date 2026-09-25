"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * One way to ask for help (1.1.125 M3).
 *
 * Five copilots — help, manage-class, analytics, authoring, tutor — each used
 * to mount its own floating pill in its own corner, so a teacher had five
 * gestures to learn and no way to know which page had which. The skills stay
 * five (each is prompt-engineered for its surface); the ENTRY becomes one: a
 * header button owned by the shell.
 *
 * A page's work copilot registers itself here on mount (title + how to open
 * it). The header button then offers the page's copilot and the help
 * assistant; on a page with no work copilot it opens help directly. Outside a
 * provider (tests, storybook, any surface without the shell) a
 * `FloatingCopilot` behaves exactly as before — its own pill.
 */
export interface RegisteredCopilot {
  title: string;
  /** Open the panel. With `prefill`, also send it as a turn — see `ask`. */
  open: (prefill?: string) => void;
}

interface CopilotEntryValue {
  /** The page's work copilot, if one is mounted. */
  registered: RegisteredCopilot | null;
  /** Called by a FloatingCopilot on mount; returns the unregister function. */
  register: (copilot: RegisteredCopilot) => () => void;
  /**
   * Open the page's work copilot and ask it something, from anywhere in the
   * surface (CONCEPT-2 M3). Returns false when no work copilot is mounted, so
   * a caller can hide its button rather than offering a dead control.
   *
   * This is the same "one way to ask" the header button is — a button on the
   * surface that phrases the question for the teacher. It sends a turn; what
   * comes back is still a PROPOSAL the teacher applies (Axiom 2), so one click
   * is a request, never a change.
   */
  ask: (text: string) => boolean;
}

/** Exported so a test can mount a surface with a stub copilot registered,
 *  without standing up the whole AG-UI chat. */
export const CopilotEntryContext = createContext<CopilotEntryValue | null>(null);

export function CopilotEntryProvider({ children }: { children: ReactNode }) {
  const [registered, setRegistered] = useState<RegisteredCopilot | null>(null);
  // Identity of the current registration, so an unmount of an OLD copilot
  // (page A) never clears the registration of a NEW one (page B) that mounted
  // first during a route transition.
  const current = useRef<RegisteredCopilot | null>(null);
  const register = useCallback((copilot: RegisteredCopilot) => {
    current.current = copilot;
    setRegistered(copilot);
    return () => {
      if (current.current === copilot) {
        current.current = null;
        setRegistered(null);
      }
    };
  }, []);
  const ask = useCallback((text: string) => {
    if (!current.current) return false;
    current.current.open(text);
    return true;
  }, []);
  const value = useMemo(() => ({ registered, register, ask }), [registered, register, ask]);
  return <CopilotEntryContext.Provider value={value}>{children}</CopilotEntryContext.Provider>;
}

/** `null` outside a provider — callers treat that as "render your own pill". */
export function useCopilotEntry(): CopilotEntryValue | null {
  return useContext(CopilotEntryContext);
}
