"use client";

import { useEffect, useState } from "react";

import { getIsResearcher, subscribeToAuthState } from "@/lib/firebase";

/**
 * Whether the current teacher carries the `role:researcher` custom claim
 * (sprint 1.1.5). Drives visibility of the cross-class Research view.
 *
 * Re-resolves on auth-state changes so the claim is picked up after a
 * token refresh (the claim takes effect on the next refresh after an
 * admin grants it). Returns false until resolved.
 */
export function useIsResearcher(): boolean {
  const [isResearcher, setIsResearcher] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const resolve = () => {
      void getIsResearcher().then((value) => {
        if (!cancelled) setIsResearcher(value);
      });
    };
    resolve();
    const unsub = subscribeToAuthState(() => resolve());
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return isResearcher;
}
