"use client";

import { useState } from "react";

import { type GrantInput, grantAccess } from "@/lib/programmeApi";

/**
 * Admit one named person (PROGADMIN-1 M2).
 *
 * A form, not a free-for-all: the cap input is bounded by the input itself AND
 * re-checked server-side, and the note is REQUIRED — "why is this person on the
 * register" is the thing nobody remembers in six weeks.
 *
 * Expiry defaults to the engagement boundary server-side, so forgetting to
 * clean up means access LAPSES rather than persists.
 */
export function GrantForm({ maxCapUsd, onGranted }: { maxCapUsd: number; onGranted: () => void }) {
  const [email, setEmail] = useState("");
  const [cap, setCap] = useState("25");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    const input: GrantInput = {
      email: email.trim(),
      tier: "pilot",
      monthlyCapUsd: Number(cap),
      note: note.trim(),
    };
    try {
      const row = await grantAccess(input);
      setOk(`${row.email} can now spend, capped at $${row.monthlyCapUsd.toFixed(2)}/month.`);
      setEmail("");
      setNote("");
      onGranted();
    } catch (err) {
      // The server names the bound it refused on. Show that, not a generic
      // failure — the person is expected to work within it.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded border border-border p-4">
      <h2 className="text-sm font-semibold">Admit a teacher</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">
          <span className="font-medium">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teacher@school.dk"
            className="rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
          {/* The match is exact. A typo must fail visibly rather than admit
              someone under an address nobody invited. */}
          <span className="text-[11px] text-muted-foreground">
            Must match the address they sign in with, exactly.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Cap (USD / month)</span>
          <input
            type="number"
            required
            min={1}
            max={maxCapUsd}
            step={1}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            className="rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
          <span className="text-[11px] text-muted-foreground">Up to ${maxCapUsd} here.</span>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium">Why (required)</span>
        <input
          type="text"
          required
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Pilot cohort A, Niels Bohr Institute"
          className="rounded border border-border bg-background px-2 py-1.5 text-sm"
        />
      </label>
      {error ? (
        <p role="alert" className="rounded border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p role="status" className="rounded border border-border bg-muted/40 p-2 text-xs">
          {ok} They pick it up on their next app load — tell them to reload.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Granting…" : "Grant access"}
      </button>
    </form>
  );
}
