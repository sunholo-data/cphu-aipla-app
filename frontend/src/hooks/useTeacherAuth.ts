"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribeToAuthState, type User } from "@/lib/firebase";
import { isLocalMode, LOCAL_MODE_WORKSHOP_USER } from "@/lib/localMode";

interface TeacherAuthState {
  user: User | null;
  loading: boolean;
}

/**
 * Standalone Firebase Auth subscription for the /teacher/* surface.
 *
 * Intentionally bypasses the app-level AuthContext (which in production
 * is wired to anonymous-group-id mode for students). Teachers sign in
 * via Firebase Google OAuth regardless of the student auth mode.
 *
 * Side-effect: redirects to /teacher/sign-in when no user is present
 * after the initial auth check, unless LOCAL_MODE is active (where the
 * workshop stub satisfies the teacher gate without real Firebase).
 *
 * Pass `{ redirectOnSignedOut: false }` on a PUBLIC page that merely wants to
 * know whether someone is signed in — /teacher-access reads the identity to
 * decide between "sign in first" and the request form, and bouncing a curious
 * visitor to sign-in there would defeat the point of the page (ACCESS-1 M4).
 */
export function useTeacherAuth(options: { redirectOnSignedOut?: boolean } = {}): TeacherAuthState {
  const { redirectOnSignedOut = true } = options;
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return subscribeToAuthState((nextUser) => {
      setUser(nextUser as User | null);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!redirectOnSignedOut) return;
    if (loading) return;
    if (user) return;
    if (isLocalMode()) return;
    router.replace("/teacher/sign-in");
  }, [user, loading, router, redirectOnSignedOut]);

  // LOCAL_MODE: synthesise a teacher identity so the dashboard renders
  // without a Firebase project configured.
  if (isLocalMode()) {
    return {
      user: LOCAL_MODE_WORKSHOP_USER as unknown as User,
      loading: false,
    };
  }

  return { user, loading };
}
