"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { subscribeToAuthState } from "@/lib/firebase";

const copy = {
  signIn: "Er du lærer? Log ind her",
  signInEn: "/ Are you a teacher? Sign in",
  signedIn: "Gå til dine klasser",
  signedInEn: "/ Go to your classes",
  signedInAs: "Logget ind som",
};

const linkClass =
  "text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";

/**
 * The homepage's teacher door. The page is a server component, so it cannot
 * know whether a teacher is already signed in — it used to say "Sign in"
 * regardless and send a signed-in teacher to the sign-in form. This reads the
 * Firebase auth state on the client and, when a teacher session exists,
 * points straight at their classes instead.
 *
 * Anonymous-group students never have a Firebase user (their token is a group
 * JWT in sessionStorage), so they always see the sign-in wording — which is
 * correct: the link is for teachers.
 */
export function TeacherEntryLink() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeToAuthState((user) =>
        setEmail(user && !user.isAnonymous ? (user.email ?? "") : null),
      ),
    [],
  );

  if (email !== null) {
    return (
      <span className="flex flex-col items-center gap-0.5">
        <Link href="/teacher/classes" className={linkClass}>
          {copy.signedIn} <span className="opacity-70">{copy.signedInEn}</span> →
        </Link>
        {email && (
          <span className="text-xs text-muted-foreground opacity-70">
            {copy.signedInAs} {email}
          </span>
        )}
      </span>
    );
  }

  return (
    <Link href="/teacher/sign-in" className={linkClass}>
      {copy.signIn} <span className="opacity-70">{copy.signInEn}</span>
    </Link>
  );
}
