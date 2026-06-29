"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A transient status toast with auto-dismiss. Replaces the
 * `const [toast, setToast] = useState<string | null>(null)` +
 * `setToast(msg); setTimeout(() => setToast(null), ms)` pattern that several
 * teacher surfaces hand-rolled.
 *
 * Clearing the prior timer on each new toast also fixes a latent overlap the
 * inline versions had: a fast second toast used to be nulled early by the
 * first toast's still-pending timer.
 */
export function useToast(defaultDurationMs = 4000) {
  const [toast, setToast] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const showToast = useCallback(
    (message: string, durationMs: number = defaultDurationMs) => {
      clear();
      setToast(message);
      timerRef.current = window.setTimeout(() => {
        setToast(null);
        timerRef.current = null;
      }, durationMs);
    },
    [clear, defaultDurationMs],
  );

  // Clear any pending timer on unmount.
  useEffect(() => clear, [clear]);

  return { toast, showToast };
}
