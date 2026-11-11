"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { type GrantInput, type RegisterRow, grantAccess } from "@/lib/programmeApi";
import { useT } from "@/i18n";

/**
 * Admit one named person (PROGADMIN-1 M2).
 *
 * A form, not a free-for-all: the cap input is bounded by the input itself AND
 * re-checked server-side, and the note is REQUIRED — "why is this person on the
 * register" is the thing nobody remembers in six weeks.
 *
 * Expiry defaults to the engagement boundary server-side, so forgetting to
 * clean up means access LAPSES rather than persists.
 *
 * Two doors (UI sweep 2026-11-11): "Grant…" on a pending request opens this
 * pre-filled from the request (email, and a note made from the institution and
 * message), so nobody retypes an address from one tab into another; the
 * standalone form stays for people who never asked. Pre-filled values are a
 * starting point the admin can change, never submitted unseen.
 */
export function GrantForm({
  maxCapUsd,
  onGranted,
  initialEmail = "",
  initialNote = "",
  heading,
  idPrefix = "grant",
}: {
  maxCapUsd: number;
  onGranted: (row: RegisterRow) => void;
  initialEmail?: string;
  initialNote?: string;
  /** Overrides the form's own title; `null` drops it (a dialog has its own). */
  heading?: string | null;
  /** Keeps ids unique when the standalone form and the dialog both exist. */
  idPrefix?: string;
}) {
  const t = useT("GrantForm");
  const [email, setEmail] = useState(initialEmail);
  const [cap, setCap] = useState("25");
  const [note, setNote] = useState(initialNote);
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
      setOk(t("granted", { email: row.email, cap: row.monthlyCapUsd.toFixed(2) }));
      setEmail("");
      setNote("");
      onGranted(row);
    } catch (err) {
      // The server names the bound it refused on. Show that, not a generic
      // failure — the person is expected to work within it.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const title = heading === undefined ? t("title") : heading;

  return (
    <form onSubmit={submit} className="space-y-3 rounded border border-border p-4">
      {title ? <h2 className="text-sm font-semibold">{title}</h2> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs sm:col-span-2" htmlFor={`${idPrefix}-email`}>
          <span className="font-medium">{t("email")}</span>
          <input
            id={`${idPrefix}-email`}
            type="email"
            name="email"
            // An address the admin types or checks, never the admin's own: a
            // password manager offering to fill it would admit the wrong person.
            autoComplete="off"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("emailPlaceholder")}
            className="rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
          {/* The match is exact. A typo must fail visibly rather than admit
              someone under an address nobody invited. */}
          <span className="text-[11px] text-muted-foreground">
            {t("emailHint")}
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs" htmlFor={`${idPrefix}-cap`}>
          <span className="font-medium">{t("cap")}</span>
          <input
            id={`${idPrefix}-cap`}
            type="number"
            name="monthlyCapUsd"
            required
            min={1}
            max={maxCapUsd}
            step={1}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            className="rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
          <span className="text-[11px] text-muted-foreground">{t("capHint", { max: maxCapUsd })}</span>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs" htmlFor={`${idPrefix}-note`}>
        <span className="font-medium">{t("why")}</span>
        <input
          id={`${idPrefix}-note`}
          type="text"
          name="note"
          autoComplete="off"
          required
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("whyPlaceholder")}
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
          {ok} {t("reloadHint")}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="sm" pending={busy} pendingLabel={t("granting")}>
        {t("grant")}
      </Button>
    </form>
  );
}
