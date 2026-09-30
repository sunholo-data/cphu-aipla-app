"use client";

import { useEffect, useState } from "react";

import {
  type ProgrammeBudgetPayload,
  fetchProgrammeBudget,
  setProgrammeBudget,
} from "@/lib/programmeApi";
import { useT } from "@/i18n";

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
  const t = useT("ProgrammeBudgetPanel");
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
    payload.spentTodayUsd === null ? t("unreadable") : `$${payload.spentTodayUsd.toFixed(2)}`;

  return (
    <section className="space-y-3 rounded border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <p className="text-xs text-muted-foreground">{t("intro")}</p>
      </div>

      <p className="text-sm">
        {t.rich("spentToday", { spent, b: (c) => <strong>{c}</strong> })}
        {payload.dailyBudgetUsd !== null
          ? t("ofBudget", { budget: payload.dailyBudgetUsd.toFixed(2) })
          : t("noBudgetSet")}
      </p>

      {payload.dailyBudgetUsd === null ? (
        <p className="text-xs text-muted-foreground">
          {t("noBudget")}
        </p>
      ) : null}

      {canWrite ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{t("dailyBudget")}</span>
            <input
              type="number"
              min={1}
              max={payload.ceilingUsd}
              step={1}
              value={value}
              disabled={busy}
              aria-label={t("dailyBudgetAria")}
              onChange={(e) => setValue(e.target.value)}
              className="w-28 rounded border border-border bg-background px-2 py-1 text-sm"
            />
            <span className="text-[11px] text-muted-foreground">{t("upTo", { max: payload.ceilingUsd })}</span>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{t("whenReached")}</span>
            <select
              value={action}
              disabled={busy}
              aria-label={t("whenReachedAria")}
              onChange={(e) => setAction(e.target.value as "warn" | "block")}
              className="rounded border border-border bg-background px-2 py-1 text-sm"
            >
              {/* warn first, and the default: a programme-wide block is a very
                  large blast radius for a knob still being calibrated. */}
              <option value="warn">{t("warn")}</option>
              <option value="block">{t("block")}</option>
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !value}
            onClick={() => save(Number(value))}
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? t("saving") : t("save")}
          </button>
          {payload.dailyBudgetUsd !== null ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => save(null)}
              className="rounded border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              {t("remove")}
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
