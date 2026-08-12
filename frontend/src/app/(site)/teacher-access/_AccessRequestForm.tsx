"use client";

import Link from "next/link";
import { useState } from "react";

import { useTeacherAuth } from "@/hooks/useTeacherAuth";
import { requestProgrammeAccess } from "@/lib/teacherApi";

/**
 * The ask half of /teacher-access (ACCESS-1 M4).
 *
 * Signed out, this points at sign-in rather than collecting anything: the
 * endpoint is authenticated, which is what keeps this from being a new
 * unauthenticated write surface on a public domain.
 *
 * Signed in, it posts once and thanks them. The response is identical whether
 * or not they are already on the register — telling a submitter "you're already
 * approved" would make this an enumeration oracle.
 */
export function AccessRequestForm() {
  const { user, loading } = useTeacherAuth({ redirectOnSignedOut: false });
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Indlæser… / Loading…</p>;
  }

  if (!user) {
    return (
      <div className="rounded border border-border bg-muted/40 p-4 text-sm">
        <p className="mb-3">
          Log ind først, så vi ved hvilken konto der skal have adgang.{" "}
          <span className="text-muted-foreground">
            Sign in first, so we know which account to grant.
          </span>
        </p>
        <Link
          href="/teacher/sign-in"
          className="inline-flex items-center rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Log ind / Sign in
        </Link>
      </div>
    );
  }

  if (sent) {
    return (
      <div
        role="status"
        className="rounded border border-border bg-muted/40 p-4 text-sm leading-relaxed"
      >
        <p className="font-medium">Tak — vi har modtaget din forespørgsel.</p>
        <p className="text-muted-foreground">
          Thanks — we have your request. We&rsquo;ll be in touch at{" "}
          <span className="font-mono">{user.email}</span>. You can keep exploring
          the recorded demonstration in the meantime.
        </p>
      </div>
    );
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestProgrammeAccess({ name, institution, message });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your request.");
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(ev) => void handleSubmit(ev)}>
      <p className="text-sm text-muted-foreground">
        Du er logget ind som <span className="font-mono">{user.email}</span> — det
        er den konto der får adgang.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          Navn / Name
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          maxLength={200}
          className="rounded border border-border bg-background px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          Institution / skole
        </span>
        <input
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
          disabled={busy}
          maxLength={200}
          className="rounded border border-border bg-background px-3 py-2 text-sm"
          placeholder="fx Niels Bohr Institutet"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          Hvad vil du bruge AIPLA til? / What would you use AIPLA for?
        </span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={busy}
          maxLength={2000}
          rows={4}
          className="rounded border border-border bg-background px-3 py-2 text-sm"
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        className="self-start rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Sender…" : "Send forespørgsel / Send request"}
      </button>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
