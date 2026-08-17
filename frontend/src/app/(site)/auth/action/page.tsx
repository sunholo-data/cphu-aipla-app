"use client";

/**
 * Custom Firebase email-action handler.
 *
 * Firebase's default action URL is `https://<project>.firebaseapp.com/__/auth/action`,
 * which is what pilot teachers were being asked to click in order to set a
 * password. A Danish gymnasium teacher receiving a password link on a
 * `firebaseapp.com` domain with no visible relationship to KU is being asked to
 * trust something shaped exactly like phishing — and the first real send landed
 * in spam. Pointing Firebase's `callbackUri` at this page puts the link on
 * `aipla.ku.dk`, the domain they already know.
 *
 * NOTE: `callbackUri` is ONE setting covering every action type, so this page
 * must handle `verifyEmail` and `recoverEmail` too, not only `resetPassword` —
 * an unhandled mode would blank-page a link the platform itself sent.
 *
 * This page must exist in production BEFORE `callbackUri` is switched. Flipping
 * the setting first would 404 every outstanding reset link, including those of
 * the ten pilot teachers whose logins were pre-created for them.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { applyEmailActionCode, confirmResetPassword, verifyResetCode } from "@/lib/firebase";
import { BRANDING } from "@/lib/branding";

/** Firebase's own floor is 6; a shared teacher machine deserves a little more. */
const MIN_PASSWORD_LENGTH = 8;

function describeActionError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? (err instanceof Error ? err.message : "");
  if (/expired-action-code/i.test(code)) {
    return (
      "This link has expired. Reset links are only valid for a short time. " +
      `Go back to the sign-in page and choose “Forgot your password?” again to get a fresh one. (${code})`
    );
  }
  if (/invalid-action-code/i.test(code)) {
    return (
      "This link is no longer valid — it may already have been used, or a newer one may have been sent. " +
      `Request a fresh link from the sign-in page. (${code})`
    );
  }
  if (/user-disabled/i.test(code)) {
    return `This account has been disabled. Contact one of the people below. (${code})`;
  }
  if (/weak-password/i.test(code)) {
    return `That password is too weak — use at least ${MIN_PASSWORD_LENGTH} characters. (${code})`;
  }
  return `Something went wrong. Contact one of the people below. (${code || "unknown error"})`;
}

function ActionHelp() {
  return (
    <div className="w-full border-t border-border pt-4 text-left">
      <p className="text-xs font-medium">Need help?</p>
      <ul className="mt-2 space-y-1">
        {BRANDING.pilotSupport.contacts.map((c) => (
          <li key={c.email} className="text-xs">
            <span className="text-muted-foreground">{c.name} — </span>
            <a className="underline" href={`mailto:${c.email}`}>
              {c.email}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AuthActionInner() {
  const router = useRouter();
  const params = useSearchParams();
  const mode = params.get("mode");
  const oobCode = params.get("oobCode");

  const [checking, setChecking] = useState(true);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!oobCode) {
        setError("This link is missing its security code. Request a fresh one from the sign-in page.");
        setChecking(false);
        return;
      }
      try {
        if (mode === "resetPassword") {
          const email = await verifyResetCode(oobCode);
          if (!cancelled) setAccountEmail(email);
        } else if (mode === "verifyEmail" || mode === "recoverEmail") {
          await applyEmailActionCode(oobCode);
          if (!cancelled) setDone(true);
        } else {
          if (!cancelled) setError(`Unsupported link type${mode ? ` (${mode})` : ""}.`);
        }
      } catch (err) {
        if (!cancelled) setError(describeActionError(err));
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [mode, oobCode]);

  const submit = useCallback(
    async (ev: React.FormEvent) => {
      ev.preventDefault();
      if (!oobCode) return;
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
      }
      if (password !== confirm) {
        setError("The two passwords do not match.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await confirmResetPassword(oobCode, password);
        setDone(true);
      } catch (err) {
        setError(describeActionError(err));
      }
      setBusy(false);
    },
    [confirm, oobCode, password],
  );

  if (checking) {
    return <p className="text-sm text-muted-foreground">Checking your link…</p>;
  }

  if (done) {
    return (
      <div className="flex w-full flex-col gap-4">
        <p role="status" className="text-sm">
          Done. You can now sign in{accountEmail ? ` as ${accountEmail}` : ""}.
        </p>
        <button
          type="button"
          onClick={() => router.replace("/teacher/sign-in")}
          className="rounded bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
        >
          Go to sign-in
        </button>
      </div>
    );
  }

  // A dead link is the likeliest failure here, so it gets the contacts too.
  if (error && !accountEmail) {
    return (
      <div className="flex w-full flex-col gap-4">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
        <a className="text-sm underline" href="/teacher/sign-in">
          Back to sign-in
        </a>
        <ActionHelp />
      </div>
    );
  }

  return (
    <form className="flex w-full flex-col gap-3 text-left" onSubmit={(ev) => void submit(ev)}>
      {/* Naming the account matters: several teachers have two granted addresses. */}
      <p className="text-sm text-muted-foreground">
        Choose a password for <strong>{accountEmail}</strong>.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">New password</span>
        <input
          type="password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          className="rounded border px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Repeat password</span>
        <input
          type="password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
          className="rounded border px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={busy || !password || !confirm}
        className="rounded bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {busy ? "Saving…" : "Set password"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ActionHelp />
    </form>
  );
}

export default function AuthActionPage() {
  return (
    <main className="mx-auto flex max-w-sm flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={BRANDING.logo.headerMark} alt={BRANDING.appName} className="h-16 w-16" />
      <h1 className="text-2xl font-semibold">{BRANDING.appName}</h1>
      {/* useSearchParams needs a Suspense boundary under the app router. */}
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <AuthActionInner />
      </Suspense>
    </main>
  );
}
