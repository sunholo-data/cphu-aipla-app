"use client";

import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type ReactNode } from "react";

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
 *
 * 2026-11-12: the menu alone hid the work copilot — teachers did not find it.
 * The page's ONE work copilot now shows its pill in the shell too (the help
 * assistant stays on demand, so there is still only one pill per page), with a
 * one-time nudge saying what it can do. The provider also carries the bottom
 * inset that keeps that pill clear of a page's sticky footer or the phone nav.
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
  /**
   * How far up from the viewport's bottom edge the floating launcher and panel
   * must sit so they never cover something fixed or sticky at the bottom of the
   * page — the wizard's footer with its primary button, the phone's bottom nav.
   * The sum of every inset registered with `useCopilotBottomInset`, in px.
   */
  bottomInset: number;
  /** Record (or, with 0, clear) one element's share of `bottomInset`. */
  setInset: (id: string, px: number) => void;
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
  // Keyed by the measuring element, so two bottom bars add up and each one
  // unmounting takes only its own share away.
  const [insets, setInsets] = useState<Record<string, number>>({});
  const setInset = useCallback((id: string, px: number) => {
    setInsets((prev) => {
      if ((prev[id] ?? 0) === px) return prev;
      const next = { ...prev };
      if (px > 0) next[id] = px;
      else delete next[id];
      return next;
    });
  }, []);
  const bottomInset = useMemo(() => Object.values(insets).reduce((a, b) => a + b, 0), [insets]);
  const value = useMemo(
    () => ({ registered, register, ask, bottomInset, setInset }),
    [registered, register, ask, bottomInset, setInset],
  );
  return <CopilotEntryContext.Provider value={value}>{children}</CopilotEntryContext.Provider>;
}

/** `null` outside a provider — callers treat that as "render your own pill". */
export function useCopilotEntry(): CopilotEntryValue | null {
  return useContext(CopilotEntryContext);
}

/**
 * Keep the floating co-pilot clear of a bar fixed or sticky at the bottom of
 * the page: put the returned ref on that bar and its height is added to the
 * co-pilot's bottom offset while it is mounted. Generic on purpose — a page
 * declares what sits at its bottom edge; the co-pilot knows no routes.
 *
 * A bar hidden at some width (`md:hidden`) measures 0 there, so it only lifts
 * the co-pilot where it is actually shown. A no-op outside a provider.
 */
export function useCopilotBottomInset<T extends HTMLElement = HTMLElement>(): (node: T | null) => void {
  const setInset = useContext(CopilotEntryContext)?.setInset;
  const id = useId();
  const observer = useRef<ResizeObserver | null>(null);
  return useCallback(
    (node: T | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!setInset) return;
      if (!node) {
        setInset(id, 0);
        return;
      }
      const measure = () => setInset(id, Math.round(node.getBoundingClientRect().height));
      measure();
      if (typeof ResizeObserver !== "undefined") {
        observer.current = new ResizeObserver(measure);
        observer.current.observe(node);
      }
    },
    [setInset, id],
  );
}

/**
 * Room at the end of the page for the co-pilot's launcher, so the last thing on
 * a page (a button, the site footer's links) can always be scrolled clear of the
 * pill. Renders only while a work co-pilot is registered.
 */
export function CopilotLauncherClearance() {
  const entry = useContext(CopilotEntryContext);
  if (!entry?.registered) return null;
  // 4.5rem = the pill (44px) plus its 1rem margin and a little air.
  return <div aria-hidden="true" style={{ height: `calc(4.5rem + ${entry.bottomInset}px)` }} />;
}
