"use client";

import { useEffect, useState } from "react";

import { subscribeToAuthState } from "@/lib/firebase";
import { isLocalMode, LOCAL_MODE_WORKSHOP_USER } from "@/lib/localMode";

/**
 * The email address of the signed-in Firebase teacher, or null (1.1.124).
 *
 * Deliberately NOT `useTeacherAuth`: that hook calls `useRouter` and bounces a
 * signed-out visitor to /teacher/sign-in. Page chrome must not carry either —
 * a banner that redirects is a banner that can hijack a page, and a `useRouter`
 * in shared chrome makes every component that renders it untestable without an
 * app-router harness (which is exactly how this was first written, and exactly
 * what the VisitorAccessBanner tests caught).
 *
 * This reads identity and nothing else.
 */
export function useSignedInEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (isLocalMode()) {
      setEmail(LOCAL_MODE_WORKSHOP_USER.email ?? null);
      return;
    }
    return subscribeToAuthState((user) => setEmail(user?.email ?? null));
  }, []);

  return email;
}
