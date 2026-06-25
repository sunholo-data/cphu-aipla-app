"use client";

import { useEffect, useRef } from "react";

import { bootstrapTeacher } from "@/lib/teacherApi";

/**
 * On a teacher's first app load, seed their onboarding demo (a Demo class +
 * example activities). The backend is idempotent — a no-op once the teacher
 * owns any class — so this fires once per mount and does nothing for an
 * established teacher.
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
      .then((result) => {
        if (result.seeded && typeof window !== "undefined") {
          window.location.reload();
        }
      })
      .catch(() => {
        // Non-fatal: onboarding is a convenience, never blocks the app.
      });
  }, [isSignedIn]);
}
