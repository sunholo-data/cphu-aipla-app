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
 *
 * UI sweep (2026-11-11): the daily budget and the "add a teacher" form are one
 * button each above the tabs; the register shows five columns with the rest in
 * a row detail (nothing dropped); a pending request has "Grant…", which opens
 * the grant form pre-filled from it; the tab is in `?tab=` so the "ask" mail
 * can link straight to the queue.
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ChevronDown, Plus, X } from "lucide-react";

import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { TeacherTabs } from "@/components/teacher/ui/TeacherTabs";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/ui/load-error";
import { BudgetPanel } from "@/app/teacher/programme/_BudgetPanel";
import { GrantForm } from "@/app/teacher/programme/_GrantForm";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useIsProgrammeAdmin } from "@/hooks/useIsProgrammeAdmin";
import { useIsResearcher } from "@/hooks/useIsResearcher";
import { useUrlTab } from "@/hooks/useUrlTab";
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
  setTeacherFeature,
} from "@/lib/programmeApi";
import { STAGE_ORDER, describeStage } from "@/lib/onboardingStage";
import { StageChip } from "@/components/teacher/StageChip";
import { useLocaleMode, useT } from "@/i18n";

/** Mirrors the server default (`PROGRAMME_ADMIN_MAX_CAP_USD`). A convenience
 *  for the input's `max`; the server re-checks and names the real bound if this
 *  ever drifts from the deployed value. */
const DELEGATED_CAP_CEILING = 50;

const TABS = ["register", "requests", "roles"] as const;
type Tab = (typeof TABS)[number];

// Copy for the roles tab lives here rather than inline in JSX — the 1.1.108
// rule: a translator reaches an object without a code change, and not JSX.
// The rest of this page predates the rule and is extracted with M2.
// 1.1.108 M2 — every label is a message in the TeacherProgrammePage namespace.
const ROLE_KEY: Record<RoleRow["roles"][number], "researcher" | "programmeAdmin" | "admin"> = {
  researcher: "researcher",
  "programme-admin": "programmeAdmin",
  admin: "admin",
};

/** A date as the reader writes one, never a raw ISO string. An unparseable
 *  value is shown as it came rather than as a plausible wrong date. */
function useFormatDate(): (iso: string) => string {
  const mode = useLocaleMode();
  return useMemo(() => {
    const fmt = new Intl.DateTimeFormat(mode === "en" ? "en-GB" : "da-DK", { dateStyle: "medium" });
    return (iso: string) => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? iso : fmt.format(d);
    };
  }, [mode]);
}

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
        {dirty || busy ? (
          <Button size="sm" className="h-7 px-2" onClick={() => void save()} pending={busy} pendingLabel={t("saving")}>
            {t("save")}
          </Button>
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
  // Was try/finally with no catch: a failed revoke said nothing, left an
  // unhandled rejection, and the row looked as though it had not been asked.
  const revoke = useAsyncAction(() => revokeAccess(row.email), { error: t("revokeFailed") });

  // Two-step rather than a browser confirm(): a modal dialog blocks the page,
  // and revoke is reversible (grant doubles as un-revoke) so it does not need
  // the heavier ceremony.
  if (!confirming) {
    return (
      <span className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={() => {
            revoke.reset();
            setConfirming(true);
          }}
          className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
        >
          {t("revoke")}
        </button>
        {revoke.error ? (
          <span role="alert" className="text-[11px] text-destructive">
            {revoke.error}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Button
        variant="destructive-outline"
        size="sm"
        className="h-7 px-2"
        pending={revoke.pending}
        pendingLabel={t("revoking")}
        onClick={async () => {
          const done = await revoke.run();
          setConfirming(false);
          if (done !== undefined) onRevoked();
        }}
      >
        {t("confirm")}
      </Button>
      <button
        type="button"
        disabled={revoke.pending}
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

/** The per-teacher Sim workshop switch (2026-10-13). Researchers AND programme
 *  admins may flip it (it commits no money beyond the teacher's own cap); the
 *  server re-checks. A failed save puts the box back and says so. */
function FeatureToggle({ row, feature, onSaved }: { row: RegisterRow; feature: string; onSaved: () => void }) {
  const t = useT("TeacherProgrammePage");
  const [on, setOn] = useState(Boolean(row.features?.[feature]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    const next = !on;
    setBusy(true);
    setError(null);
    setOn(next);
    try {
      await setTeacherFeature(row.email, feature, next);
      onSaved();
    } catch {
      setOn(!next);
      setError(t("featureSaveFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <input
        type="checkbox"
        checked={on}
        disabled={busy || !row.active}
        onChange={() => void toggle()}
        aria-label={t("featureSimWorkshopFor", { email: row.email })}
      />
      {on ? t("featureOn") : t("featureOff")}
      {error ? <span role="alert" className="text-destructive">{error}</span> : null}
    </label>
  );
}

function RegisterTable({
  rows,
  canWrite,
  canSetFeatures = false,
  onChanged,
  stages,
}: {
  rows: RegisterRow[];
  canWrite: boolean;
  /** Researcher or programme admin: may switch per-teacher features. */
  canSetFeatures?: boolean;
  onChanged: () => void;
  /** Onboarding stage by email (1.1.124 M0); absent while loading or on a
   *  read failure — the column then shows a dash, never a guessed stage. */
  stages?: Map<string, OnboardingRow>;
}) {
  const t = useT("TeacherProgrammePage");
  const tStage = useT("StageChip");
  const formatDate = useFormatDate();
  const [sortByStage, setSortByStage] = useState(false);
  /** Rows whose detail (tier, expires, granted by/via, note) is open. */
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
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
  const toggleRow = (email: string) =>
    setOpenRows((cur) => {
      const next = new Set(cur);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  // Five columns; the rest of each grant is one click down in the row detail.
  const columns = 5;
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
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <th className="py-2 pr-3 font-medium">{t("colEmail")}</th>
            <th className="py-2 pr-3 font-medium">{t("colStage")}</th>
            <th className="py-2 pr-3 font-medium">{t("colCap")}</th>
            <th className="py-2 pr-3 font-medium">{t("colSimWorkshop")}</th>
            <th className="py-2 pr-3 font-medium">{t("colActions")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const open = openRows.has(row.email);
            const detailId = `grant-detail-${row.email}`;
            return [
              <tr key={row.email} className="border-b border-border/60 align-top">
                <td className="py-2 pr-3 font-medium">
                  {row.email}
                  {!row.active ? (
                    <span className="ml-2 rounded border border-destructive px-1.5 py-0.5 text-[11px] text-destructive">
                      {row.revoked ? t("revoked") : t("lapsed")}
                    </span>
                  ) : null}
                </td>
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
                <td className="py-2 pr-3" data-testid="feature-cell">
                  {canSetFeatures ? (
                    <FeatureToggle row={row} feature="simWorkshop" onSaved={onChanged} />
                  ) : row.features?.simWorkshop ? (
                    t("featureOn")
                  ) : (
                    t("featureOff")
                  )}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap items-start gap-1">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={detailId}
                      aria-label={open ? t("detailsHideFor", { email: row.email }) : t("detailsShowFor", { email: row.email })}
                      onClick={() => toggleRow(row.email)}
                      className="flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
                    >
                      {t("details")}
                      <ChevronDown className={`h-3 w-3 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                    </button>
                    {canWrite && row.active ? <RevokeButton row={row} onRevoked={onChanged} /> : null}
                  </div>
                </td>
              </tr>,
              // Kept mounted and `hidden` when closed, so nothing about a grant
              // is ever only in a column that no longer exists.
              <tr key={`${row.email}-detail`} id={detailId} hidden={!open} className="border-b border-border/60 bg-muted/30">
                <td colSpan={columns} className="px-3 py-2">
                  <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-muted-foreground">{t("colTier")}</dt>
                      <dd>{row.tier}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("colExpires")}</dt>
                      <dd>{row.expiresAt ? formatDate(row.expiresAt) : t("never")}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("colGrantedBy")}</dt>
                      <dd className="flex flex-wrap items-center gap-1">
                        <span>{row.grantedBy || "—"}</span>
                        <GrantedViaBadge via={row.grantedVia} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("colNote")}</dt>
                      <dd>{row.note || "—"}</dd>
                    </div>
                  </dl>
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function RequestsTable({
  rows,
  onGrant,
}: {
  rows: AccessRequestRow[];
  /** Programme admin only: open the grant form pre-filled from this request. */
  onGrant?: (row: AccessRequestRow) => void;
}) {
  const t = useT("TeacherProgrammePage");
  const formatDate = useFormatDate();
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
            {onGrant ? (
              <th className="py-2 pr-3 font-medium">
                <span className="sr-only">{t("colActions")}</span>
              </th>
            ) : null}
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
              <td className="py-2 pr-3 text-muted-foreground">{row.requestedAt ? formatDate(row.requestedAt) : "—"}</td>
              {onGrant ? (
                <td className="py-2 pr-3">
                  {row.status === "pending" ? (
                    <Button
                      size="sm"
                      className="border-brand/60 font-semibold text-brand hover:bg-brand/10"
                      aria-label={t("grantForAria", { email: row.email })}
                      onClick={() => onGrant(row)}
                    >
                      {t("grantFor")}
                    </Button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The grant form in a side panel, pre-filled from one request. */
function GrantFromRequestPanel({
  request,
  onClose,
  onGranted,
}: {
  request: AccessRequestRow | null;
  onClose: () => void;
  onGranted: (email: string, cap: number) => void;
}) {
  const t = useT("TeacherProgrammePage");
  // The note says where the person came from, in the admin's language; the
  // institution and message are the requester's own words, quoted as given.
  const details = request ? [request.institution, request.message].filter((s) => s && s.trim()).join(" — ") : "";
  const note = details ? t("noteFromRequest", { details }) : t("noteFromRequestBare");
  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col gap-4 overflow-y-auto border-l border-border bg-background p-5 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold">
                {t("grantDialogTitle", { email: request?.email ?? "" })}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {t("grantDialogNote")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("close")}>
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          {request ? (
            <GrantForm
              key={request.uid}
              idPrefix="grant-request"
              heading={null}
              maxCapUsd={DELEGATED_CAP_CEILING}
              initialEmail={request.email}
              initialNote={note}
              onGranted={(row) => onGranted(row.email, row.monthlyCapUsd)}
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function TeacherProgrammePage() {
  const t = useT("TeacherProgrammePage");
  const tGrant = useT("GrantForm");
  const isResearcher = useIsResearcher();
  const isProgrammeAdmin = useIsProgrammeAdmin();
  const mayRead = isResearcher || isProgrammeAdmin;

  const [tab, setTab] = useUrlTab<Tab>("tab", TABS, "register");
  const [register, setRegister] = useState<RegisterRow[] | null>(null);
  const [requests, setRequests] = useState<AccessRequestRow[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  // 1.1.124 M0 — by email. Undefined while loading OR when the read failed:
  // the column must show "—" rather than a stage it did not read.
  const [stages, setStages] = useState<Map<string, OnboardingRow> | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** The request whose "Grant…" is open in the side panel. */
  const [granting, setGranting] = useState<AccessRequestRow | null>(null);
  /** The standalone form, for a teacher who never asked. */
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  const pending = (requests ?? []).filter((r) => r.status === "pending").length;

  const body = (content: React.ReactNode) =>
    loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : content;

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
          // A researcher is not read-only here: they can switch the Sim
          // workshop per teacher. Say what is theirs and what is not.
          : t("subtitleReadOnly")
      }
    >
      {!mayRead ? (
        <div role="alert" className="rounded border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          {t("noAccess")}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-2">
            <BudgetPanel canWrite={isProgrammeAdmin} />
            {isProgrammeAdmin ? (
              <Button aria-expanded={addOpen} onClick={() => setAddOpen((v) => !v)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("addTeacher")}
              </Button>
            ) : null}
          </div>

          {isProgrammeAdmin && addOpen ? (
            <GrantForm maxCapUsd={DELEGATED_CAP_CEILING} onGranted={() => load()} />
          ) : null}

          {notice ? (
            <p role="status" className="rounded border border-border bg-muted/40 p-2 text-sm">
              {notice}
            </p>
          ) : null}

          {error ? (
            <LoadError what={t("loadWhat")} retrying={loading} onRetry={() => load()} />
          ) : (
            <TeacherTabs
              ariaLabel={t("title")}
              active={tab}
              onChange={(id) => setTab(id as Tab)}
              tabs={[
                {
                  id: "register",
                  label: t("tabRegister"),
                  count: register?.length,
                  content: body(
                    <RegisterTable
                      rows={register ?? []}
                      canWrite={isProgrammeAdmin}
                      canSetFeatures={mayRead}
                      onChanged={load}
                      stages={stages}
                    />,
                  ),
                },
                {
                  id: "requests",
                  label: t("tabRequests"),
                  count: requests ? pending : undefined,
                  content: (
                    <>
                      {/* There is no email notification anywhere in this flow —
                          the queue does not tell anyone it has something in it.
                          Say so, so a reader knows checking it is their job. */}
                      <p className="text-xs text-muted-foreground">{t("nobodyNotified")}</p>
                      {body(
                        <RequestsTable
                          rows={requests ?? []}
                          onGrant={isProgrammeAdmin ? (row) => setGranting(row) : undefined}
                        />,
                      )}
                    </>
                  ),
                },
                {
                  id: "roles",
                  label: t("rolesTab"),
                  count: roles?.length,
                  content: (
                    <>
                      <p className="text-xs text-muted-foreground">{t("rolesIntro")}</p>
                      {body(<RolesTable rows={roles ?? []} />)}
                    </>
                  ),
                },
              ]}
            />
          )}

          <GrantFromRequestPanel
            request={granting}
            onClose={() => setGranting(null)}
            onGranted={(email, cap) => {
              setGranting(null);
              setNotice(`${tGrant("granted", { email, cap: cap.toFixed(2) })} ${tGrant("reloadHint")}`);
              load();
            }}
          />
        </>
      )}
    </TeacherPage>
  );
}
