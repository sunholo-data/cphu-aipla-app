"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithEmail,
  signInWithGoogle,
  signInWithGoogleRedirect,
} from "@/lib/firebase";
import { BRANDING } from "@/lib/branding";

export default function TeacherSignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"choose" | "email">("choose");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogle() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      router.replace("/teacher/classes");
    } catch {
      try {
        await signInWithGoogleRedirect();
        // redirect flow navigates away — no router.replace needed
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
        setBusy(false);
      }
    }
  }

  async function handleEmail(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithEmail(email, password);
      router.replace("/teacher/classes");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed.";
      // Surface friendly messages for common Firebase error codes.
      if (msg.includes("invalid-credential") || msg.includes("wrong-password") || msg.includes("user-not-found")) {
        setError("Incorrect email or password.");
      } else if (msg.includes("too-many-requests")) {
        setError("Too many attempts. Try again later.");
      } else if (msg.includes("operation-not-allowed") || msg.includes("OPERATION_NOT_ALLOWED") || msg.includes("PASSWORD_LOGIN_DISABLED")) {
        setError("Email/password sign-in is not enabled. Ask your administrator to enable it in the Firebase Console.");
      } else {
        setError(msg);
      }
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={BRANDING.logo.headerMark}
        alt={BRANDING.appName}
        className="h-16 w-16"
      />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{BRANDING.appName} Teacher</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to access your dashboard.
        </p>
      </div>

      {mode === "choose" ? (
        <div className="flex w-full flex-col gap-3">
          <button
            type="button"
            onClick={() => void handleGoogle()}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded border border-border bg-background px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-accent disabled:opacity-60"
          >
            {busy ? "Signing in…" : <><GoogleMark /> Sign in with Google</>}
          </button>
          <button
            type="button"
            onClick={() => setMode("email")}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded border border-border bg-background px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-accent disabled:opacity-60"
          >
            Sign in with email
          </button>
        </div>
      ) : (
        <form className="flex w-full flex-col gap-3 text-left" onSubmit={(ev) => void handleEmail(ev)}>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Email</span>
            <input
              type="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              className="rounded border px-3 py-2 text-sm"
              placeholder="teacher@example.com"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              className="rounded border px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !email || !password}
            className="rounded bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => { setMode("choose"); setError(null); }}
            disabled={busy}
            className="text-xs text-muted-foreground underline"
          >
            Back
          </button>
        </form>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </main>
  );
}

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}
