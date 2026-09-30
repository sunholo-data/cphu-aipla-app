"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/i18n";
import { subscribeToAuthState } from "@/lib/firebase";

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
  // 1.1.108 — the person's own language (DA | EN switch), not both at once.
  const t = useT("TeacherEntryLink");
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
          {t("signedIn")}
        </Link>
        {email && (
          <span className="text-xs text-muted-foreground opacity-70">
            {t("signedInAs", { email })}
          </span>
        )}
      </span>
    );
  }

  return (
    <Link href="/teacher/sign-in" className={linkClass}>
      {t("signIn")}
    </Link>
  );
}
