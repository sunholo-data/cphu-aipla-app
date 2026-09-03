/**
 * /teacher/programme — delegated programme administration (PROGADMIN-1 — 1.1.76).
 *
 * Who may spend money on AIPLA, and who has asked to.
 *
 * NOT filed under /teacher/research/*: a programme admin is not necessarily a
 * researcher, and filing an administrative surface under "research" would make
 * the naming lie about who it is for.
 *
 * Read-only and write are the SAME surface at different privilege levels — a
 * researcher sees exactly what a programme admin sees, minus the buttons. Two
 * surfaces would drift, and the read-only view's whole value is that the person
 * looking at it can tell you what they see.
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { BudgetPanel } from "@/app/teacher/programme/_BudgetPanel";
import { GrantForm } from "@/app/teacher/programme/_GrantForm";
import { useIsProgrammeAdmin } from "@/hooks/useIsProgrammeAdmin";
import { useIsResearcher } from "@/hooks/useIsResearcher";
import {
  type AccessRequestRow,
  type RegisterRow,
  fetchAccessRequests,
  fetchRegister,
  formatCap,
  formatSpend,
  grantAccess,
  isUncapped,
  revokeAccess,
  spendState,
} from "@/lib/programmeApi";

/** Mirrors the server default (`PROGRAMME_ADMIN_MAX_CAP_USD`). A convenience
 *  for the input's `max`; the server re-checks and names the real bound if this
 *  ever drifts from the deployed value. */
const DELEGATED_CAP_CEILING = 50;

type Tab = "register" | "requests";

function GrantedViaBadge({ via }: { via: string }) {
  // Empty means a row written before 1.1.76, when the SA path was the only
  // door. Say so rather than rendering a blank the reader has to interpret.
  const label = via === "programme-admin" ? "delegated" : "service account";
  const title =
    via === "programme-admin"
      ? "Granted in-app by a programme admin, under the delegated bounds"
      : "Granted via the service-account path (unbounded)";
  return (
    <span
      title={title}
      className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground"
    >
      {label}
    </span>
  );
}

function SpendBadge({ row }: { row: RegisterRow }) {
  const state = spendState(row);
  // "unreadable" is its own state and must never be dressed as $0.00 — the
  // reassuring answer is exactly what a broken read produces.
  const tone =
    state === "over"
      ? "text-destructive font-semibold"
      : state === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : state === "unknown"
          ? "text-muted-foreground italic"
          : "text-muted-foreground";
  return (
    <div className={`text-[11px] ${tone}`} title="Spend so far this period, against the cap">
      {formatSpend(row)} this period
    </div>
  );
}

function CapEditor({ row, onSaved }: { row: RegisterRow; onSaved: () => void }) {
  const [value, setValue] = useState(String(row.monthlyCapUsd));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = Number(value) !== row.monthlyCapUsd;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // "Change the cap" is the same idempotent call as "grant" — the panel
      // needs a field, not a mechanism. Re-send the note so it is preserved.
      await grantAccess({
        email: row.email,
        tier: row.tier,
        monthlyCapUsd: Number(value),
        expiresAt: row.expiresAt ?? undefined,
        note: row.note,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setValue(String(row.monthlyCapUsd));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span aria-hidden="true">$</span>
        <input
          type="number"
          min={1}
          max={DELEGATED_CAP_CEILING}
          step={1}
          value={value}
          disabled={busy}
          aria-label={`Monthly cap for ${row.email}`}
          onChange={(e) => setValue(e.target.value)}
          className="w-20 rounded border border-border bg-background px-1.5 py-0.5 text-sm"
        />
        {dirty ? (
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50"
          >
            {busy ? "…" : "Save"}
          </button>
        ) : null}
      </div>
      {error ? (
        <span role="alert" className="text-[11px] text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function RevokeButton({ row, onRevoked }: { row: RegisterRow; onRevoked: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Two-step rather than a browser confirm(): a modal dialog blocks the page,
  // and revoke is reversible (grant doubles as un-revoke) so it does not need
  // the heavier ceremony.
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
      >
        Revoke
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await revokeAccess(row.email);
            onRevoked();
          } finally {
            setBusy(false);
            setConfirming(false);
          }
        }}
        className="rounded border border-destructive px-1.5 py-0.5 text-[11px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
      >
        {busy ? "…" : "Confirm"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-[11px] text-muted-foreground hover:underline"
      >
        Cancel
      </button>
    </span>
  );
}

function RegisterTable({
  rows,
  canWrite,
  onChanged,
}: {
  rows: RegisterRow[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        The register is empty — which means <strong>every account on this environment is a
        visitor</strong>, including established teachers. That is almost certainly not what you
        want on a live environment.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Email</th>
            <th className="py-2 pr-3 font-medium">Tier</th>
            <th className="py-2 pr-3 font-medium">Cap / month</th>
            <th className="py-2 pr-3 font-medium">Expires</th>
            <th className="py-2 pr-3 font-medium">Granted by</th>
            <th className="py-2 pr-3 font-medium">Note</th>
            {canWrite ? <th className="py-2 pr-3 font-medium">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.email} className="border-b border-border/60 align-top">
              <td className="py-2 pr-3 font-medium">
                {row.email}
                {!row.active ? (
                  <span className="ml-2 rounded border border-destructive px-1.5 py-0.5 text-[11px] text-destructive">
                    {row.revoked ? "revoked" : "lapsed"}
                  </span>
                ) : null}
              </td>
              <td className="py-2 pr-3">{row.tier}</td>
              <td className="py-2 pr-3">
                {isUncapped(row) ? (
                  // An alarm, not a blank: cap<0 disables the per-teacher gate
                  // outright, so this row is bounded only by the shared
                  // project ceiling and can starve every other teacher on it.
                  <span
                    role="status"
                    title="No per-teacher limit. Bounded only by the shared project quota."
                    className="rounded border border-destructive bg-destructive/10 px-1.5 py-0.5 text-[11px] font-semibold text-destructive"
                  >
                    UNCAPPED
                  </span>
                ) : canWrite ? (
                  <CapEditor row={row} onSaved={onChanged} />
                ) : (
                  formatCap(row)
                )}
                {/* The cap next to the spend it bounds. Setting caps blind is
                    how this register arrived at "uncapped" once already. */}
                <SpendBadge row={row} />
              </td>
              <td className="py-2 pr-3 text-muted-foreground">{row.expiresAt ?? "never"}</td>
              <td className="py-2 pr-3 text-muted-foreground">
                <div>{row.grantedBy || "—"}</div>
                <GrantedViaBadge via={row.grantedVia} />
              </td>
              <td className="py-2 pr-3 text-muted-foreground">{row.note || "—"}</td>
              {canWrite ? (
                <td className="py-2 pr-3">
                  {row.active ? <RevokeButton row={row} onRevoked={onChanged} /> : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequestsTable({ rows }: { rows: AccessRequestRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        No pending requests.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Email</th>
            <th className="py-2 pr-3 font-medium">Name</th>
            <th className="py-2 pr-3 font-medium">Institution</th>
            <th className="py-2 pr-3 font-medium">Message</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 font-medium">Asked</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.uid} className="border-b border-border/60 align-top">
              <td className="py-2 pr-3 font-medium">{row.email}</td>
              <td className="py-2 pr-3">{row.name || "—"}</td>
              <td className="py-2 pr-3 text-muted-foreground">{row.institution || "—"}</td>
              <td className="py-2 pr-3 text-muted-foreground">{row.message || "—"}</td>
              <td className="py-2 pr-3">{row.status}</td>
              <td className="py-2 pr-3 text-muted-foreground">{row.requestedAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TeacherProgrammePage() {
  const isResearcher = useIsResearcher();
  const isProgrammeAdmin = useIsProgrammeAdmin();
  const mayRead = isResearcher || isProgrammeAdmin;

  const [tab, setTab] = useState<Tab>("register");
  const [register, setRegister] = useState<RegisterRow[] | null>(null);
  const [requests, setRequests] = useState<AccessRequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!mayRead) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchRegister(), fetchAccessRequests("all")])
      .then(([reg, req]) => {
        if (cancelled) return;
        setRegister(reg.grants);
        setRequests(req.requests);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mayRead]);

  useEffect(() => load(), [load]);

  return (
    <TeacherPage
      breadcrumb={
        <Link href="/teacher/classes" className="flex w-fit items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Dashboard
        </Link>
      }
      title="Programme"
      subtitle={
        isProgrammeAdmin
          ? "Who may spend on AIPLA, and who has asked to"
          : "Who may spend on AIPLA, and who has asked to (read-only)"
      }
    >
      {!mayRead ? (
        <div role="alert" className="rounded border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          This view is available to programme administrators and researchers.
        </div>
      ) : (
        <>
          <div className="flex gap-2 border-b border-border">
            {(["register", "requests"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-current={tab === t ? "page" : undefined}
                className={
                  tab === t
                    ? "border-b-2 border-brand px-3 py-2 text-sm font-medium text-foreground"
                    : "px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                }
              >
                {t === "register" ? "Register" : "Requests"}
                {t === "register" && register ? ` (${register.length})` : null}
                {t === "requests" && requests
                  ? ` (${requests.filter((r) => r.status === "pending").length})`
                  : null}
              </button>
            ))}
          </div>

          {/* There is no email notification anywhere in this flow — the queue
              does not tell anyone it has something in it. Say so, so a reader
              knows checking it is their job. */}
          <p className="text-xs text-muted-foreground">
            Nobody is notified when someone asks for access. Check this queue after any round of
            publicity, or when someone says they asked.
          </p>

          {tab === "register" ? <BudgetPanel canWrite={isProgrammeAdmin} /> : null}

          {isProgrammeAdmin && tab === "register" ? (
            <GrantForm maxCapUsd={DELEGATED_CAP_CEILING} onGranted={load} />
          ) : null}

          {error ? (
            <div role="alert" className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tab === "register" ? (
            <RegisterTable rows={register ?? []} canWrite={isProgrammeAdmin} onChanged={load} />
          ) : (
            <RequestsTable rows={requests ?? []} />
          )}
        </>
      )}
    </TeacherPage>
  );
}
