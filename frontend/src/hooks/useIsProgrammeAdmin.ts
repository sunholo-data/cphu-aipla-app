"use client";

import { useEffect, useState } from "react";

import { getIsProgrammeAdmin, subscribeToAuthState } from "@/lib/firebase";

/**
 * Whether the current teacher carries the `programmeAdmin` custom claim
 * (PROGADMIN-1 — 1.1.76). Drives the write half of `/teacher/programme`:
 * a researcher sees the same surface with no buttons.
 *
 * Re-resolves on auth-state changes so the claim is picked up after a token
 * refresh — the claim takes effect on the next refresh after it is minted, so
 * a freshly granted admin who does not reload would otherwise still see the
 * read-only view. Returns false until resolved, which is the safe direction.
 */
export function useIsProgrammeAdmin(): boolean {
  const [isProgrammeAdmin, setIsProgrammeAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const resolve = () => {
      void getIsProgrammeAdmin().then((value) => {
        if (!cancelled) setIsProgrammeAdmin(value);
      });
    };
    resolve();
    const unsub = subscribeToAuthState(() => resolve());
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return isProgrammeAdmin;
}
