"use client";

import { useEffect, useState } from "react";

/**
 * MOBILE-1 — true when the viewport is narrower than `minPx`.
 *
 * Used to tell a student honestly that a sim needs a bigger screen, rather than
 * mounting it and letting half the apparatus render off the right edge
 * (LED-Planck's fixed-coordinate bench). Pass `null`/`undefined` for artefacts
 * with no minimum and this is always false.
 *
 * Starts false and resolves in an effect, deliberately: the server has no
 * viewport, so any other initial value would hydrate a mismatch. The practical
 * effect is that the notice appears a frame late, which is the right way round
 * — a flash of "too small" on a desktop would be worse than a flash of the
 * launcher on a phone.
 *
 * Listens to resize because the case that matters is real: a student rotates
 * the iPad, or a teacher demos on a laptop with a narrow window.
 */
export function useViewportTooNarrow(minPx: number | null | undefined): boolean {
  const [tooNarrow, setTooNarrow] = useState(false);

  useEffect(() => {
    if (!minPx) {
      setTooNarrow(false);
      return;
    }
    // `max-width` is inclusive, so subtract 1px: a viewport exactly at the
    // minimum is wide enough, not too narrow.
    const mq = window.matchMedia(`(max-width: ${minPx - 1}px)`);
    const sync = () => setTooNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [minPx]);

  return tooNarrow;
}
