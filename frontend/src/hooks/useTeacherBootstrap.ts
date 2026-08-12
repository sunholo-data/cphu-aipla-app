"use client";

import { useEffect, useRef } from "react";

import { setAccessTier } from "@/lib/accessTier";
import { getFirebaseAuth } from "@/lib/firebase";
import { bootstrapTeacher } from "@/lib/teacherApi";

/**
 * On a teacher's first app load, seed their onboarding demo (a Demo class +
 * example activities). The backend is idempotent — a no-op once the teacher
 * owns any class — so this fires once per mount and does nothing for an
 * established teacher.
 *
 * It is also the ACCESS-1 tier-reconciliation point. The backend compares the
 * `teacher_access` register (source of truth) to the token's `accessTier` claim
 * (the copy the auth hot path reads) and corrects the claim on drift. Two
 * client-side consequences:
 *
 *  - `accessTier` is recorded so surfaces can render the visitor nudge without
 *    waiting to hit a 402;
 *  - `tierChanged` means the claim was just rewritten, so the CURRENT token is
 *    stale. Force-refresh it, otherwise a teacher granted access keeps being
 *    refused until Firebase rotates the token on its own (up to an hour).
 *
 * When the backend reports it JUST seeded (first sign-in ever, or the first
 * sign-in after a clean-slate wipe), reload once so the current page shows the
 * freshly-created demo. That reload happens at most once per teacher account.
 */
export function useTeacherBootstrap(isSignedIn: boolean): void {
  const ran = useRef(false);
  useEffect(() => {
    if (!isSignedIn || ran.current) return;
    ran.current = true;
    bootstrapTeacher()
      .then(async (result) => {
        setAccessTier(result.accessTier);

        if (result.tierChanged) {
          // getIdToken(true) forces a refresh against Firebase rather than
          // returning the cached one, so the new claim is carried immediately.
          // Awaited before the reload below so the post-reload requests use it.
          try {
            await getFirebaseAuth()?.currentUser?.getIdToken(true);
          } catch {
            // Non-fatal: the next natural refresh picks the claim up.
          }
        }

        if ((result.seeded || result.tierChanged) && typeof window !== "undefined") {
          window.location.reload();
        }
      })
      .catch(() => {
        // Non-fatal: onboarding is a convenience, never blocks the app.
      });
  }, [isSignedIn]);
}
