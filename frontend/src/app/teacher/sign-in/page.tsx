"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signInWithGoogleRedirect,
} from "@/lib/firebase";
import { BRANDING } from "@/lib/branding";
import { useT, type Translate } from "@/i18n";

export default function TeacherSignInPage() {
  const router = useRouter();
  const t = useT("TeacherSignInPage");
  const [mode, setMode] = useState<"choose" | "email">("choose");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleGoogle() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await signInWithGoogle();
      router.replace("/teacher/classes");
    } catch {
      try {
        await signInWithGoogleRedirect();
        // redirect flow navigates away — no router.replace needed
      } catch (err) {
        // The commonest cause is not a broken popup: it is a school with no
        // Google identity at all, where Google sign-in can never succeed. Say
        // so, and name the door that does work.
        setError(t("googleFailed", { detail: describeRawError(err, t) }));
        setBusy(false);
      }
    }
  }

  /**
   * Never confirms whether the address has an account — that would turn this
   * form into a way to ask who is registered. But it must never dead-end
   * either: a first-time teacher whose account was never created would
   * otherwise wait forever for an email that is not coming. So the message
   * stays non-committal AND always says what to do when nothing arrives.
   */
  async function handleReset() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await sendPasswordReset(email);
      setNotice(t("resetSent", { email }));
    } catch (err) {
      setError(t("resetFailed", { detail: describeRawError(err, t) }));
    }
    setBusy(false);
  }

  async function handleEmail(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await signInWithEmail(email, password);
      router.replace("/teacher/classes");
    } catch (err) {
      setError(describeSignInError(err, t));
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
        <h1 className="text-2xl font-semibold">{t("brand", { app: BRANDING.appName })}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>

      {mode === "choose" ? (
        <div className="flex w-full flex-col gap-3">
          <button
            type="button"
            onClick={() => void handleGoogle()}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded border border-border bg-background px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-accent disabled:opacity-60"
          >
            {busy ? t("signingIn") : <><GoogleMark /> {t("withGoogle")}</>}
          </button>
          <button
            type="button"
            onClick={() => setMode("email")}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded border border-border bg-background px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-accent disabled:opacity-60"
          >
            {t("withEmail")}
          </button>
        </div>
      ) : (
        <form className="flex w-full flex-col gap-3 text-left" onSubmit={(ev) => void handleEmail(ev)}>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t("email")}</span>
            <input
              type="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              className="rounded border px-3 py-2 text-sm"
              placeholder={t("emailPlaceholder")}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t("password")}</span>
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
            {busy ? t("signingIn") : t("signIn")}
          </button>
          {/* Needs only the email, so it stays enabled while the password box is
              empty — which is exactly the state someone who forgot it is in. */}
          <button
            type="button"
            onClick={() => void handleReset()}
            disabled={busy || !email}
            className="text-xs text-muted-foreground underline disabled:opacity-60"
          >
            {t("forgot")}
          </button>
          <button
            type="button"
            onClick={() => { setMode("choose"); setError(null); setNotice(null); }}
            disabled={busy}
            className="text-xs text-muted-foreground underline"
          >
            {t("back")}
          </button>
        </form>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      <SignInHelp />
    </main>
  );
}

/**
 * The raw Firebase code, kept visible in every message.
 *
 * A teacher will not know what `auth/invalid-credential` means, but the person
 * they forward the screenshot to does — and a message that hides it turns a
 * ten-second diagnosis into a conversation. Shown in parentheses after the
 * human-readable half, never instead of it.
 */
type SignInT = Translate<"TeacherSignInPage">;

function describeRawError(err: unknown, t: SignInT): string {
  const code = (err as { code?: string })?.code;
  if (typeof code === "string" && code) return code;
  if (err instanceof Error && err.message) return err.message;
  return t("unknownError");
}

/**
 * Every branch ends with something the teacher can DO. The first-time case —
 * no account yet — is the one that used to dead-end as "Incorrect email or
 * password", which reads as "I typed it wrong" when the truth is "nobody has
 * created your login".
 */
function describeSignInError(err: unknown, t: SignInT): string {
  const detail = describeRawError(err, t);
  if (/invalid-credential|wrong-password|user-not-found|INVALID_LOGIN/i.test(detail)) {
    return t("badCredentials", { detail });
  }
  if (/too-many-requests/i.test(detail)) return t("tooMany", { detail });
  if (/operation-not-allowed|OPERATION_NOT_ALLOWED|PASSWORD_LOGIN_DISABLED/i.test(detail)) {
    // Was "ask your administrator to enable it in the Firebase Console" — a
    // sentence written for a developer and shown to a physics teacher.
    return t("emailDisabled", { detail });
  }
  if (/network-request-failed/i.test(detail)) return t("network", { detail });
  return t("failed", { detail });
}

/**
 * Always rendered, not only after a failure. A teacher who cannot get in has by
 * definition no route to in-app help, so the escape hatch has to be on the page
 * they are already stuck on, before anything goes wrong.
 */
function SignInHelp() {
  const t = useT("TeacherSignInPage");
  return (
    <div className="w-full border-t border-border pt-4 text-left">
      <p className="text-xs font-medium">{t("helpTitle")}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t.rich("helpBody", { b: (c) => <strong>{c}</strong> })}
      </p>
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
