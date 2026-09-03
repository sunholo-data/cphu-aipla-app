"use client";

import { useEffect, useState } from "react";

import {
  type ProgrammeBudgetPayload,
  fetchProgrammeBudget,
  setProgrammeBudget,
} from "@/lib/programmeApi";

/**
 * Programme-wide DAILY budget (PROGADMIN-1 M3 — 1.1.76).
 *
 * Sits one layer below the immutable GCP quota and one above the per-teacher
 * monthly caps. It answers "what did the whole programme spend today?", which
 * no per-teacher monthly cap can — and stops a bad Tuesday across every class
 * at once.
 *
 * Settable by a programme admin, VISIBLE to a researcher — same split as the
 * register, same reasoning.
 */
export function BudgetPanel({ canWrite }: { canWrite: boolean }) {
  const [payload, setPayload] = useState<ProgrammeBudgetPayload | null>(null);
  const [value, setValue] = useState("");
  const [action, setAction] = useState<"warn" | "block">("warn");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetchProgrammeBudget()
      .then((p) => {
        setPayload(p);
        setValue(p.dailyBudgetUsd === null ? "" : String(p.dailyBudgetUsd));
        setAction(p.action);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, []);

  const save = async (next: number | null) => {
    setBusy(true);
    setError(null);
    try {
      await setProgrammeBudget(next, action);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!payload) return null;

  const spent =
    payload.spentTodayUsd === null ? "unreadable" : `$${payload.spentTodayUsd.toFixed(2)}`;

  return (
    <section className="space-y-3 rounded border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">Programme daily budget</h2>
        <p className="text-xs text-muted-foreground">
          Across every teacher. Sits under the project&rsquo;s hard quota and above the
          per-teacher monthly caps — it is the only thing that can see a bad day across all
          classes at once.
        </p>
      </div>

      <p className="text-sm">
        Spent today: <strong>{spent}</strong>
        {payload.dailyBudgetUsd !== null ? ` of $${payload.dailyBudgetUsd.toFixed(2)}` : " — no budget set"}
      </p>

      {payload.dailyBudgetUsd === null ? (
        <p className="text-xs text-muted-foreground">
          No budget is set. The per-teacher caps and the project quota still apply; this knob
          adds a programme-wide daily ceiling on top of them.
        </p>
      ) : null}

      {canWrite ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">Daily budget (USD)</span>
            <input
              type="number"
              min={1}
              max={payload.ceilingUsd}
              step={1}
              value={value}
              disabled={busy}
              aria-label="Programme daily budget in USD"
              onChange={(e) => setValue(e.target.value)}
              className="w-28 rounded border border-border bg-background px-2 py-1 text-sm"
            />
            <span className="text-[11px] text-muted-foreground">Up to ${payload.ceilingUsd}.</span>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">When reached</span>
            <select
              value={action}
              disabled={busy}
              aria-label="Action when the budget is reached"
              onChange={(e) => setAction(e.target.value as "warn" | "block")}
              className="rounded border border-border bg-background px-2 py-1 text-sm"
            >
              {/* warn first, and the default: a programme-wide block is a very
                  large blast radius for a knob still being calibrated. */}
              <option value="warn">Warn only</option>
              <option value="block">Block new turns</option>
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !value}
            onClick={() => save(Number(value))}
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save budget"}
          </button>
          {payload.dailyBudgetUsd !== null ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => save(null)}
              className="rounded border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              Remove budget
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
