"use client";

/**
 * The class's groups, ONE table (UI sweep 2026-11, approved 2026-11-11).
 *
 * Replaces four lists of the same groups on the class page: the Live list,
 * the Groups/codes list, the browser-only Class list, and (for "last active")
 * Recent activity. One row per live code:
 *
 *   Kode | Navne (kun i din browser) | Status | Sidst aktiv | Beskeder | actions
 *
 * Visible per row: Kopiér link and Rapport. Kopiér kode, Start en ny samtale
 * and Tilbagekald koden… are in the ⋯ menu. Excel download/import of the names
 * sit in the table header. Revoked codes keep their own disclosure underneath
 * (1.1.146 — revoke ends access, never evidence).
 *
 * ⚠️ PRIVACY BOUNDARY (ADR-001) — this component holds the teacher's names for
 * each group. They come from `useClassList` (localStorage) and go nowhere else.
 * This file imports no API client: every row action is a callback that is
 * handed a CODE, never a name. `__tests__/_ClassListSheet.test.tsx` types a
 * name, exports, imports and fires every row action, and fails if the name
 * reaches a request or a callback.
 */

import { useRef, type ReactNode } from "react";
import Link from "next/link";
import { FileSpreadsheet, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RowMenu } from "@/components/ui/row-menu";
import { SettingsSection } from "@/components/teacher/ui/SettingsSection";
import { formatRelativeTime } from "@/lib/relativeTime";
import { cn } from "@/lib/utils";
import { useT, type Locale } from "@/i18n";

import { useClassList } from "./_ClassListSheet";
import { MenuButton } from "./_MenuButton";

/** What the live poll says about a group (structural subset of `LiveClass`). */
export interface GroupLiveSignals {
  calls: ReadonlyArray<{ groupId: string }>;
  groups: ReadonlyArray<{
    groupId: string;
    status: string;
    turns: number;
    lastActivityAt: string;
    idleSeconds: number;
    stuck: boolean;
    activityTitle: string;
  }>;
}

/** The group's latest session, from the class's recent sessions. */
export interface GroupLatest {
  lastMessageAt: string;
  turnCount: number;
  title: string | null;
}

export type GroupStatus =
  | { kind: "hand" }
  | { kind: "active" }
  | { kind: "quiet"; minutes: number; stuck: boolean }
  | { kind: "not-started" }
  | { kind: "unknown" };

/** One group's status for the Status column. A raised hand wins; then the
 *  live signal; a code with no live session in the 90-minute window has not
 *  started this lesson. With no live answer at all, say so rather than guess. */
export function groupStatus(code: string, live: GroupLiveSignals | null): GroupStatus {
  if (!live) return { kind: "unknown" };
  if (live.calls.some((c) => c.groupId === code)) return { kind: "hand" };
  const g = live.groups.find((x) => x.groupId === code);
  if (!g) return { kind: "not-started" };
  if (g.status === "active") return { kind: "active" };
  return { kind: "quiet", minutes: Math.max(1, Math.round(g.idleSeconds / 60)), stuck: g.stuck };
}

export interface GroupsTableProps {
  classId: string;
  className: string;
  liveCodes: ReadonlyArray<string>;
  retiredCodes: ReadonlyArray<string>;
  revokedAt?: Record<string, string>;
  joinOrigin: string;
  /** The rich "students join at …" explanation, rendered by the page. */
  description: ReactNode;
  live: GroupLiveSignals | null;
  liveError: boolean;
  latestByGroup: ReadonlyMap<string, GroupLatest>;
  timeLocale: Locale;
  minting: boolean;
  onNewGroup: () => void;
  onCopyLink: (code: string) => void;
  onCopyCode: (code: string) => void;
  onReset: (code: string) => void;
  onRevoke: (code: string) => void;
}

export function GroupsTable({
  classId,
  className,
  liveCodes,
  retiredCodes,
  revokedAt,
  joinOrigin,
  description,
  live,
  liveError,
  latestByGroup,
  timeLocale,
  minting,
  onNewGroup,
  onCopyLink,
  onCopyCode,
  onReset,
  onRevoke,
}: GroupsTableProps) {
  const t = useT("ClassDetailPage");
  const tList = useT("ClassListSheet");
  const tLive = useT("LiveClassView");
  const list = useClassList({ classId, className, codes: liveCodes, retainedCodes: retiredCodes, joinOrigin });
  const fileRef = useRef<HTMLInputElement>(null);
  const now = Date.now();

  const liveByCode = new Map((live?.groups ?? []).map((g) => [g.groupId, g]));

  return (
    <SettingsSection
      id="groups"
      title={t("groupsCount", { n: liveCodes.length })}
      description={description}
      action={
        <>
          <MenuButton
            label={t("excelMenu")}
            icon={<FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />}
            disabled={liveCodes.length === 0}
            items={[
              { id: "excel-download", label: tList("download"), onSelect: list.download },
              {
                id: "excel-import",
                label: `${tList("importButton")}…`,
                hint: tList("importHelp"),
                onSelect: () => fileRef.current?.click(),
              },
            ]}
          />
          <Button variant="primary" size="sm" onClick={() => onNewGroup()} pending={minting} pendingLabel={t("creating")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("newGroup")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {liveError ? (
          <p role="alert" className="text-xs text-muted-foreground">
            {tLive("loadFailed")}
          </p>
        ) : null}
        {list.storageOk === false ? (
          <p
            role="alert"
            className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          >
            {tList("storageUnavailable")}
          </p>
        ) : null}

        {liveCodes.length === 0 ? (
          <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            {t("noCodes")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full min-w-[44rem] text-sm" data-testid="groups-table">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">{t("colCode")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("colNames")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("colStatus")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("colLastActive")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t("colMessages")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    <span className="sr-only">{t("colActions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {liveCodes.map((code) => {
                  const lg = liveByCode.get(code);
                  const latest = latestByGroup.get(code);
                  const lastAt = lg?.lastActivityAt || latest?.lastMessageAt || "";
                  const messages = lg ? lg.turns : latest ? latest.turnCount : null;
                  const doing = lg?.activityTitle || latest?.title || "";
                  return (
                    <tr key={code} data-testid={`group-row-${code}`}>
                      <td className="px-3 py-2 align-top">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{code}</code>
                      </td>
                      <td className="min-w-[12rem] px-3 py-1.5 align-top">
                        <input
                          type="text"
                          value={list.entries[code]?.names ?? ""}
                          onChange={(e) => list.update(code, "names", e.target.value)}
                          aria-label={tList("namesLabel", { code })}
                          placeholder={tList("namesPlaceholder")}
                          autoComplete="off"
                          className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                        />
                        <input
                          type="text"
                          value={list.entries[code]?.note ?? ""}
                          onChange={(e) => list.update(code, "note", e.target.value)}
                          aria-label={tList("noteLabel", { code })}
                          placeholder={tList("notePlaceholder")}
                          autoComplete="off"
                          className="mt-1 w-full rounded border border-transparent bg-transparent px-2 py-0.5 text-xs text-muted-foreground hover:border-border focus:border-border focus:bg-background"
                        />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <StatusChip status={groupStatus(code, live)} />
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                        {lastAt ? formatRelativeTime(lastAt, now, timeLocale) : "—"}
                        {doing ? <span className="block max-w-[12rem] truncate" title={doing}>{doing}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right align-top tabular-nums">{messages ?? "—"}</td>
                      <td className="px-3 py-1.5 align-top">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => onCopyLink(code)}
                            aria-label={t("copyJoinLinkAria", { code })}
                            title={t("copyJoinLinkTitle", { link: `${joinOrigin}/group?code=${code}` })}
                          >
                            {t("copyJoinLink")}
                          </Button>
                          <Link
                            href={`/teacher/reports/groups/${encodeURIComponent(code)}`}
                            aria-label={t("reportAria", { code })}
                            className="inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-primary hover:bg-muted hover:underline"
                          >
                            {t("report")}
                          </Link>
                          <RowMenu
                            label={t("moreActionsFor", { code })}
                            items={[
                              { id: "copy-code", label: t("copyCode"), hint: t("copyCodeTitle"), onSelect: () => onCopyCode(code) },
                              { id: "reset", label: t("resetSession"), hint: t("resetHint"), onSelect: () => onReset(code) },
                              {
                                id: "revoke",
                                label: t("revokeMenu"),
                                hint: t("revokeHint"),
                                danger: true,
                                onSelect: () => onRevoke(code),
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {t("pollHint")} {tList("keptLocally")}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          data-testid="class-list-import"
          onChange={(e) => {
            const input = e.currentTarget;
            void list.importFile(input.files?.[0]).finally(() => {
              input.value = "";
            });
          }}
        />
        {list.importMsg ? (
          <p
            role="status"
            className={
              list.importMsg.tone === "ok" ? "text-sm text-foreground" : "text-sm text-amber-700 dark:text-amber-300"
            }
          >
            {list.importMsg.text}
          </p>
        ) : null}

        {/* 1.1.146 — revoked codes stay reachable. Revoke ends access, never
            evidence: no join link, reset or revoke here, but the report link a
            teacher or researcher needs to review the group's sessions. */}
        {retiredCodes.length > 0 ? (
          <details className="rounded border border-border" data-testid="revoked-codes">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              {t("revokedCodes", { n: retiredCodes.length })}
            </summary>
            <p className="px-3 pb-2 text-xs text-muted-foreground">{t("revokedCodesDescription")}</p>
            <ul className="divide-y divide-border border-t border-border">
              {retiredCodes.map((code) => {
                const at = revokedAt?.[code];
                const latest = latestByGroup.get(code);
                const names = list.entries[code]?.names;
                return (
                  <li key={code} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <code className="w-fit rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-muted-foreground line-through decoration-muted-foreground/50">
                        {code}
                      </code>
                      <span className="text-xs text-muted-foreground">
                        {at ? t("revokedOn", { when: formatRelativeTime(at, now, timeLocale) }) : t("revokedUndated")}
                        {latest
                          ? ` · ${t("lastActive", { when: formatRelativeTime(latest.lastMessageAt, now, timeLocale), n: latest.turnCount })}`
                          : ""}
                        {names ? ` · ${names}` : ""}
                      </span>
                    </div>
                    <Link
                      href={`/teacher/reports/groups/${encodeURIComponent(code)}`}
                      className="inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-primary hover:bg-muted hover:underline"
                      aria-label={t("reportAria", { code })}
                    >
                      {t("report")}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </details>
        ) : null}
      </div>
    </SettingsSection>
  );
}

function StatusChip({ status }: { status: GroupStatus }) {
  const t = useT("ClassDetailPage");
  const base = "inline-flex w-fit items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium";
  switch (status.kind) {
    case "hand":
      return (
        <span className={cn(base, "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100")}>
          {t("statusHand")}
        </span>
      );
    case "active":
      return <span className={cn(base, "border-success/40 bg-success/10 text-foreground")}>{t("statusActive")}</span>;
    case "quiet":
      return (
        <span
          className={cn(
            base,
            status.stuck
              ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
              : "border-border bg-muted text-muted-foreground",
          )}
          title={status.stuck ? t("statusQuietStuck", { n: status.minutes }) : undefined}
          data-stuck={status.stuck || undefined}
        >
          {t("statusQuiet", { n: status.minutes })}
          {status.stuck ? <span className="sr-only">. {t("statusQuietStuck", { n: status.minutes })}</span> : null}
        </span>
      );
    case "not-started":
      return <span className={cn(base, "border-border text-muted-foreground")}>{t("statusNotStarted")}</span>;
    default:
      return <span className="text-xs text-muted-foreground">{t("statusUnknown")}</span>;
  }
}
