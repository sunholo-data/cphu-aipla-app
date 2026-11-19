"use client";

import { useEffect, useState } from "react";

import { getFirebaseAuth, subscribeToAuthState } from "@/lib/firebase";
import { isLocalMode, LOCAL_MODE_WORKSHOP_USER } from "@/lib/localMode";

/** Stands in for an account where there is only ever one: no Firebase
 *  configured (a build, a test, an unconfigured local checkout). */
export const SINGLE_ACCOUNT = "local";

function accountNow(): string | null {
  if (isLocalMode()) return LOCAL_MODE_WORKSHOP_USER.uid;
  const auth = getFirebaseAuth();
  if (!auth) return SINGLE_ACCOUNT;
  return auth.currentUser?.uid ?? null;
}

/**
 * The uid of the account signed in to this browser, for keying what a co-pilot
 * remembers; `null` until Firebase has said who it is (or when signed out).
 *
 * Deliberately not `useTeacherAuth`: that one redirects and needs the app
 * router, and the co-pilot is a panel inside a page that already owns its
 * sign-in gate. It only needs to know WHOSE thread to resume.
 */
export function useCopilotAccount(): string | null {
  const [uid, setUid] = useState<string | null>(accountNow);
  useEffect(() => {
    if (isLocalMode() || !getFirebaseAuth()) return;
    return subscribeToAuthState((user) => setUid(user?.uid ?? null));
  }, []);
  return uid;
}
