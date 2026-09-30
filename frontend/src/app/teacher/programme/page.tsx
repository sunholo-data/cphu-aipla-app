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
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { BudgetPanel } from "@/app/teacher/programme/_BudgetPanel";
import { GrantForm } from "@/app/teacher/programme/_GrantForm";
import { useIsProgrammeAdmin } from "@/hooks/useIsProgrammeAdmin";
import { useIsResearcher } from "@/hooks/useIsResearcher";
import {
  type AccessRequestRow,
  type RegisterRow,
  type OnboardingRow,
  type RoleRow,
  fetchAccessRequests,
  fetchOnboarding,
  fetchRegister,
  fetchRoles,
  formatCap,
  formatSpend,
  grantAccess,
  isUncapped,
  revokeAccess,
  spendState,
} from "@/lib/programmeApi";
import { STAGE_ORDER, describeStage } from "@/lib/onboardingStage";
import { StageChip } from "@/components/teacher/StageChip";
import { useT } from "@/i18n";

/** Mirrors the server default (`PROGRAMME_ADMIN_MAX_CAP_USD`). A convenience
 *  for the input's `max`; the server re-checks and names the real bound if this
 *  ever drifts from the deployed value. */
const DELEGATED_CAP_CEILING = 50;

type Tab = "register" | "requests" | "roles";

// Copy for the roles tab lives here rather than inline in JSX — the 1.1.108
// rule: a translator reaches an object without a code change, and not JSX.
// The rest of this page predates the rule and is extracted with M2.
// 1.1.108 M2 — every label is a message in the TeacherProgrammePage namespace.
const ROLE_KEY: Record<RoleRow["roles"][number], "researcher" | "programmeAdmin" | "admin"> = {
  researcher: "researcher",
  "programme-admin": "programmeAdmin",
  admin: "admin",
};

function GrantedViaBadge({ via }: { via: string }) {
  const t = useT("TeacherProgrammePage");
  // Empty means a row written before 1.1.76, when the SA path was the only
  // door. Say so rather than rendering a blank the reader has to interpret.
  const label = via === "programme-admin" ? t("viaDelegated") : t("viaServiceAccount");
  const title = via === "programme-admin" ? t("viaDelegatedTitle") : t("viaServiceAccountTitle");
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
  const t = useT("TeacherProgrammePage");
  const state = spendState(row);
  // formatSpend's English "unreadable" is the lib's diagnostic; say it in the
  // teacher's language here.
  const spent =
    row.spentThisPeriodUsd === null || row.spentThisPeriodUsd === undefined ? t("unreadable") : formatSpend(row);
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
    <div className={`text-[11px] ${tone}`} title={t("spendTitle")}>
      {t("spendThisPeriod", { spent })}
    </div>
  );
}

function CapEditor({ row, onSaved }: { row: RegisterRow; onSaved: () => void }) {
  const t = useT("TeacherProgrammePage");
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
          aria-label={t("capAria", { email: row.email })}
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
            {busy ? "…" : t("save")}
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
  const t = useT("TeacherProgrammePage");
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
        {t("revoke")}
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
        {busy ? "…" : t("confirm")}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-[11px] text-muted-foreground hover:underline"
      >
        {t("cancel")}
      </button>
    </span>
  );
}

function RolesTable({ rows }: { rows: RoleRow[] }) {
  const t = useT("TeacherProgrammePage");
  if (rows.length === 0) {
    return (
      <p className="rounded border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        {t("rolesEmpty")}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-3 font-medium">{t("colEmail")}</th>
            <th className="py-2 pr-3 font-medium">{t("colRoles")}</th>
            <th className="py-2 pr-3 font-medium">{t("colSpend")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.uid} className="border-b border-border/60 align-top">
              <td className="py-2 pr-3 font-medium">{row.email || row.uid}</td>
              <td className="py-2 pr-3">
                <div className="flex flex-wrap gap-1">
                  {row.roles.map((r) => (
                    <span
                      key={r}
                      title={t(`roleTitle_${ROLE_KEY[r]}`)}
                      className="rounded border border-border px-1.5 py-0.5 text-[11px]"
                    >
                      {t(`role_${ROLE_KEY[r]}`)}
                    </span>
                  ))}
                </div>
              </td>
              {/* No grant is the case this table exists to show; say it in
                  words, never as a blank cell. */}
              <td className="py-2 pr-3">
                {row.grant ? (
                  <span className="text-muted-foreground">
                    {row.grant.tier} ·{" "}
                    {row.grant.monthlyCapUsd < 0
                      ? t("uncappedInline")
                      : t("perMonth", { amount: row.grant.monthlyCapUsd.toFixed(2) })}{" "}
                    · {t("grantOnRegister")}
                  </span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">{t("noGrant")}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RegisterTable({
  rows,
  canWrite,
  onChanged,
  stages,
}: {
  rows: RegisterRow[];
  canWrite: boolean;
  onChanged: () => void;
  /** Onboarding stage by email (1.1.124 M0); absent while loading or on a
   *  read failure — the column then shows a dash, never a guessed stage. */
  stages?: Map<string, OnboardingRow>;
}) {
  const t = useT("TeacherProgrammePage");
  const tStage = useT("StageChip");
  const [sortByStage, setSortByStage] = useState(false);
  const sorted = useMemo(() => {
    if (!sortByStage || !stages) return rows;
    const order = new Map(STAGE_ORDER.map((st, i) => [st, i]));
    return [...rows].sort((a, b) => {
      const sa = stages.get(a.email);
      const sb = stages.get(b.email);
      // Rows without a stage (lapsed, unreadable) sink to the bottom.
      if (!sa || !sb) return sa ? -1 : sb ? 1 : 0;
      return (order.get(sa.stage) ?? 0) - (order.get(sb.stage) ?? 0) || (sb.days ?? 0) - (sa.days ?? 0);
    });
  }, [rows, stages, sortByStage]);
  if (rows.length === 0) {
    return (
      <p className="rounded border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        {t.rich("registerEmpty", { b: (c) => <strong>{c}</strong> })}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      {stages ? (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            aria-pressed={sortByStage}
            onClick={() => setSortByStage((v) => !v)}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
          >
            {sortByStage ? t("sortByGrant") : t("sortByStage")}
          </button>
        </div>
      ) : null}
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <th className="py-2 pr-3 font-medium">{t("colEmail")}</th>
            <th className="py-2 pr-3 font-medium">{t("colTier")}</th>
            <th className="py-2 pr-3 font-medium">{t("colStage")}</th>
            <th className="py-2 pr-3 font-medium">{t("colCap")}</th>
            <th className="py-2 pr-3 font-medium">{t("colExpires")}</th>
            <th className="py-2 pr-3 font-medium">{t("colGrantedBy")}</th>
            <th className="py-2 pr-3 font-medium">{t("colNote")}</th>
            {canWrite ? <th className="py-2 pr-3 font-medium">{t("colActions")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.email} className="border-b border-border/60 align-top">
              <td className="py-2 pr-3 font-medium">
                {row.email}
                {!row.active ? (
                  <span className="ml-2 rounded border border-destructive px-1.5 py-0.5 text-[11px] text-destructive">
                    {row.revoked ? t("revoked") : t("lapsed")}
                  </span>
                ) : null}
              </td>
              <td className="py-2 pr-3">{row.tier}</td>
              <td className="py-2 pr-3" data-testid="stage-cell">
                {(() => {
                  const st = stages?.get(row.email);
                  if (!st) return <span className="text-muted-foreground">{t("stageUnavailable")}</span>;
                  return (
                    <div className="flex flex-col gap-0.5">
                      <StageChip stage={st.stage} label={describeStage(st, tStage)} title={st.since ?? undefined} />
                      {st.nextStep ? (
                        <span className="text-xs text-muted-foreground">{tStage("next", {
                            // The backend's next step is fixed per stage; say it by stage so it
                            // follows the reader's language (its English stays for the co-pilot).
                            step: st.stage !== "live" ? tStage(`nextStep_${st.stage}`) : st.nextStep,
                          })}</span>
                      ) : null}
                    </div>
                  );
                })()}
              </td>
              <td className="py-2 pr-3">
                {isUncapped(row) ? (
                  // An alarm, not a blank: cap<0 disables the per-teacher gate
                  // outright, so this row is bounded only by the shared
                  // project ceiling and can starve every other teacher on it.
                  <span
                    role="status"
                    title={t("uncappedTitle")}
                    className="rounded border border-destructive bg-destructive/10 px-1.5 py-0.5 text-[11px] font-semibold text-destructive"
                  >
                    {t("uncapped")}
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
              <td className="py-2 pr-3 text-muted-foreground">{row.expiresAt ?? t("never")}</td>
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
  const t = useT("TeacherProgrammePage");
  if (rows.length === 0) {
    return (
      <p className="rounded border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        {t("requestsEmpty")}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <th className="py-2 pr-3 font-medium">{t("colEmail")}</th>
            <th className="py-2 pr-3 font-medium">{t("colName")}</th>
            <th className="py-2 pr-3 font-medium">{t("colInstitution")}</th>
            <th className="py-2 pr-3 font-medium">{t("colMessage")}</th>
            <th className="py-2 pr-3 font-medium">{t("colStatus")}</th>
            <th className="py-2 pr-3 font-medium">{t("colAsked")}</th>
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
  const t = useT("TeacherProgrammePage");
  const isResearcher = useIsResearcher();
  const isProgrammeAdmin = useIsProgrammeAdmin();
  const mayRead = isResearcher || isProgrammeAdmin;

  const [tab, setTab] = useState<Tab>("register");
  const [register, setRegister] = useState<RegisterRow[] | null>(null);
  const [requests, setRequests] = useState<AccessRequestRow[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  // 1.1.124 M0 — by email. Undefined while loading OR when the read failed:
  // the column must show "—" rather than a stage it did not read.
  const [stages, setStages] = useState<Map<string, OnboardingRow> | undefined>(undefined);
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
    Promise.all([fetchRegister(), fetchAccessRequests("all"), fetchRoles()])
      .then(([reg, req, rol]) => {
        if (cancelled) return;
        setRegister(reg.grants);
        setRequests(req.requests);
        setRoles(rol.people);
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

  // The stage column loads beside the register, not inside it: it is a slower
  // read (one activity summary per class) and a failure must not take the
  // register down with it.
  useEffect(() => {
    if (!mayRead) return;
    let cancelled = false;
    fetchOnboarding()
      .then((r) => {
        if (!cancelled) setStages(new Map(r.teachers.map((t) => [t.email, t])));
      })
      .catch(() => {
        if (!cancelled) setStages(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [mayRead]);

  return (
    <TeacherPage
      breadcrumb={
        <Link href="/teacher/classes" className="flex w-fit items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("dashboard")}
        </Link>
      }
      title={t("title")}
      subtitle={
        isProgrammeAdmin
          ? t("subtitleAdmin")
          : t("subtitleReadOnly")
      }
    >
      {!mayRead ? (
        <div role="alert" className="rounded border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          {t("noAccess")}
        </div>
      ) : (
        <>
          <div className="flex gap-2 border-b border-border">
            {(["register", "requests", "roles"] as Tab[]).map((tb) => (
              <button
                key={tb}
                type="button"
                onClick={() => setTab(tb)}
                aria-current={tab === tb ? "page" : undefined}
                className={
                  tab === tb
                    ? "border-b-2 border-brand px-3 py-2 text-sm font-medium text-foreground"
                    : "px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                }
              >
                {tb === "register" ? t("tabRegister") : tb === "requests" ? t("tabRequests") : t("rolesTab")}
                {tb === "register" && register ? ` (${register.length})` : null}
                {tb === "roles" && roles ? ` (${roles.length})` : null}
                {tb === "requests" && requests
                  ? ` (${requests.filter((r) => r.status === "pending").length})`
                  : null}
              </button>
            ))}
          </div>

          {/* There is no email notification anywhere in this flow — the queue
              does not tell anyone it has something in it. Say so, so a reader
              knows checking it is their job. */}
          <p className="text-xs text-muted-foreground">
            {t("nobodyNotified")}
          </p>

          {tab === "roles" ? <p className="text-xs text-muted-foreground">{t("rolesIntro")}</p> : null}

          {tab === "register" ? <BudgetPanel canWrite={isProgrammeAdmin} /> : null}

          {isProgrammeAdmin && tab === "register" ? (
            <GrantForm maxCapUsd={DELEGATED_CAP_CEILING} onGranted={load} />
          ) : null}

          {error ? (
            <div role="alert" className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : tab === "register" ? (
            <RegisterTable rows={register ?? []} canWrite={isProgrammeAdmin} onChanged={load} stages={stages} />
          ) : tab === "requests" ? (
            <RequestsTable rows={requests ?? []} />
          ) : (
            <RolesTable rows={roles ?? []} />
          )}
        </>
      )}
    </TeacherPage>
  );
}
