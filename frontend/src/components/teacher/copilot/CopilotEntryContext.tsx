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
  open: () => void;
}

interface CopilotEntryValue {
  /** The page's work copilot, if one is mounted. */
  registered: RegisteredCopilot | null;
  /** Called by a FloatingCopilot on mount; returns the unregister function. */
  register: (copilot: RegisteredCopilot) => () => void;
}

const CopilotEntryContext = createContext<CopilotEntryValue | null>(null);

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
  const value = useMemo(() => ({ registered, register }), [registered, register]);
  return <CopilotEntryContext.Provider value={value}>{children}</CopilotEntryContext.Provider>;
}

/** `null` outside a provider — callers treat that as "render your own pill". */
export function useCopilotEntry(): CopilotEntryValue | null {
  return useContext(CopilotEntryContext);
}
