"use client";

// LessonOverview — one lesson, the whole class first (1.1.139 M2).
//
// Reading order, top to bottom: which concepts the class discussed, struggled
// with or (by the tutor's own record) understood; how the tutor taught, with
// coverage stated before anything else; what next; then the groups, outliers
// first, each a drill-in to its report. A teacher never has to open a group to
// answer "what did the class get?".
//
// Copy: messages/{da,en}/teacher-lessons.json (LessonOverview), via useT.

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";

import { useT, type Translate } from "@/i18n";
import type {
  LessonConcept,
  LessonConceptStatus,
  LessonDetail,
  LessonGroupRow,
} from "@/lib/lessonOverviewApi";
import { cn } from "@/lib/utils";

type T = Translate<"LessonOverview">;
type Filter = "all" | LessonConceptStatus;

const FILTERS: Filter[] = ["all", "struggled", "discussed", "demonstrated"];

/** Cell colour per status — semantic, not brand (no red: struggling is not an error). */
const CELL: Record<LessonConceptStatus, string> = {
  demonstrated: "bg-emerald-500/80 border-emerald-600",
  struggled: "bg-amber-400/90 border-amber-500",
  discussed: "bg-sky-300/70 border-sky-400",
};

export function groupReportHref(lesson: LessonDetail, group: LessonGroupRow): string {
  const q = new URLSearchParams({
    session_id: group.latestSessionId,
    lessonActivity: lesson.activityId,
    lessonDate: lesson.date,
  });
  return `/teacher/reports/groups/${encodeURIComponent(group.groupCode)}?${q.toString()}`;
}

export function filterConcepts(concepts: LessonConcept[], query: string, filter: Filter): LessonConcept[] {
  const q = query.trim().toLowerCase();
  return concepts.filter(
    (c) => (!q || c.label.toLowerCase().includes(q)) && (filter === "all" || c.counts[filter] > 0),
  );
}

export function LessonOverview({
  lesson,
  onSummarise,
  summarising = false,
  summariseError = false,
  summariseCap = 8,
}: {
  lesson: LessonDetail;
  /** The explicit "summarise the rest" action; omitted = no button. */
  onSummarise?: () => void;
  summarising?: boolean;
  summariseError?: boolean;
  summariseCap?: number;
}) {
  const t = useT("LessonOverview");
  return (
    <div className="flex flex-col gap-6" data-testid="lesson-overview">
      {lesson.coverage.pendingSessions > 0 || lesson.coverage.unsummarisable > 0 ? (
        <div
          className="flex flex-col gap-2 rounded border border-border bg-muted/40 p-3 text-sm"
          data-testid="lesson-pending"
        >
          {lesson.coverage.pendingSessions > 0 ? (
            <p>{t("pending", { n: lesson.coverage.pendingSessions })}</p>
          ) : null}
          {lesson.coverage.unsummarisable > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("unsummarisable", { n: lesson.coverage.unsummarisable })}
            </p>
          ) : null}
          {onSummarise && lesson.coverage.pendingSessions > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onSummarise}
                disabled={summarising}
                className="rounded border border-border bg-background px-3 py-1 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                {summarising ? t("summarising") : t("summarise")}
              </button>
              <span className="text-xs text-muted-foreground">{t("summariseCap", { n: summariseCap })}</span>
              {summariseError ? (
                <span role="alert" className="text-xs text-destructive">
                  {t("summariseFailed")}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <ConceptsSection lesson={lesson} t={t} />
      <ApproachSection lesson={lesson} t={t} />
      <NextSection lesson={lesson} t={t} />
      <GroupsSection lesson={lesson} t={t} />
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded border border-border bg-background p-4">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ConceptsSection({ lesson, t }: { lesson: LessonDetail; t: T }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const shown = useMemo(() => filterConcepts(lesson.concepts, query, filter), [lesson.concepts, query, filter]);
  const groups = lesson.groups.map((g) => g.groupCode).sort();
  const current = lesson.concepts.find((c) => c.key === selected) ?? null;

  return (
    <Section id="lesson-concepts" title={t("conceptsTitle")}>
      {lesson.concepts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noConcepts")}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("conceptsIntro")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative flex items-center">
              <span className="sr-only">{t("searchLabel")}</span>
              <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchLabel")}
                className="h-8 w-56 rounded border border-border bg-background pl-7 pr-2 text-sm"
              />
            </label>
            <div role="group" aria-label={t("filterLabel")} className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs",
                    filter === f ? "border-primary bg-accent font-medium" : "border-border hover:bg-accent",
                  )}
                >
                  {t(`filter_${f}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-1" data-testid="concept-chips">
            {shown.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={selected === c.key}
                onClick={() => setSelected(selected === c.key ? null : c.key)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs",
                  selected === c.key ? "border-primary bg-accent font-medium" : "border-border hover:bg-accent",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noMatch", { q: query })}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="border-separate border-spacing-1 text-xs" data-testid="concept-strip">
                <thead>
                  <tr>
                    <th scope="col" className="sr-only">
                      {t("conceptsTitle")}
                    </th>
                    {groups.map((g) => (
                      <th key={g} scope="col" className="px-1 text-left font-mono font-normal text-muted-foreground">
                        {g}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => {
                    const by = new Map(c.groups.map((x) => [x.groupCode, x.status]));
                    return (
                      <tr key={c.key}>
                        <th scope="row" className="pr-2 text-left font-normal">
                          <button
                            type="button"
                            onClick={() => setSelected(selected === c.key ? null : c.key)}
                            className="text-left hover:underline"
                          >
                            {c.label}
                          </button>
                        </th>
                        {groups.map((g) => {
                          const status = by.get(g);
                          return (
                            <td key={g}>
                              <span
                                role="img"
                                aria-label={t("cellAria", {
                                  group: g,
                                  status: status ? t(`status_${status}`) : t("status_none"),
                                })}
                                className={cn(
                                  "block h-4 w-6 rounded-sm border",
                                  status ? CELL[status] : "border-border bg-transparent",
                                )}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("legendDemonstrated")}</p>
          {current ? <ConceptDetail concept={current} t={t} /> : null}
        </>
      )}
    </Section>
  );
}

function ConceptDetail({ concept, t }: { concept: LessonConcept; t: T }) {
  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-muted/30 p-3" data-testid="concept-detail">
      <h3 className="text-sm font-semibold">{t("groupsFor", { concept: concept.label })}</h3>
      <p className="text-xs text-muted-foreground">
        {t("counts", {
          discussed: concept.counts.discussed,
          struggled: concept.counts.struggled,
          demonstrated: concept.counts.demonstrated,
        })}
        {concept.mapped ? ` · ${t("mapped")}` : null}
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {concept.groups.map((g) => (
          <li key={g.groupCode} className="flex flex-wrap gap-x-2">
            <code className="font-mono text-xs">{g.groupCode}</code>
            <span className="font-medium">{t(`status_${g.status}`)}</span>
            <span className="text-muted-foreground">{g.evidence ?? t("noEvidence")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ApproachSection({ lesson, t }: { lesson: LessonDetail; t: T }) {
  const a = lesson.approach;
  const cov = a.coverage;
  return (
    <Section id="lesson-approach" title={t("approachTitle")}>
      {a.state === "no_framework" ? (
        <p className="text-sm" data-testid="approach-none">
          {t("noFramework")}
        </p>
      ) : (
        <>
          {a.frameworkLabel ? <p className="text-sm font-medium">{t("approachName", { name: a.frameworkLabel })}</p> : null}
          <ul className="flex flex-col gap-0.5 text-sm" data-testid="approach-coverage">
            <li>{t("coverage", { assessed: cov.assessed ?? 0, groups: cov.groups })}</li>
            {cov.tooShort ? <li className="text-muted-foreground">{t("tooShort", { n: cov.tooShort })}</li> : null}
            {cov.abstained ? <li className="text-muted-foreground">{t("abstained", { n: cov.abstained })}</li> : null}
            {cov.notJudged ? <li className="text-muted-foreground">{t("notJudged", { n: cov.notJudged })}</li> : null}
            {cov.otherApproach ? (
              <li className="text-muted-foreground">{t("otherApproach", { n: cov.otherApproach })}</li>
            ) : null}
          </ul>
          {a.state === "not_assessed" ? (
            <p className="text-sm text-muted-foreground">{t("notAssessed")}</p>
          ) : lesson.synthesis?.approach ? (
            <p className="text-sm" data-testid="approach-synthesis">
              {lesson.synthesis.approach}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("synthesisPending")}</p>
          )}
          {a.groupSummaries && a.groupSummaries.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">{t("groupReadings")}</summary>
              <ul className="mt-2 flex flex-col gap-2">
                {a.groupSummaries.map((g) => (
                  <li key={g.groupCode}>
                    <code className="font-mono text-xs">{g.groupCode}</code> {g.summary}
                    {g.drift.length > 0 ? (
                      <span className="block text-xs text-muted-foreground">
                        {t("drift", { text: g.drift.join("; ") })}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {a.bands ? <BandsTable bands={a.bands} t={t} /> : null}
        </>
      )}
    </Section>
  );
}

function BandsTable({ bands, t }: { bands: Record<string, Record<string, number>>; t: T }) {
  const levels = ["absent", "partial", "strong"] as const;
  return (
    <div className="flex flex-col gap-1" data-testid="approach-bands">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">{t("bandsTitle")}</h3>
      <table className="text-xs">
        <thead>
          <tr>
            <th />
            {levels.map((l) => (
              <th key={l} scope="col" className="px-2 text-right font-normal text-muted-foreground">
                {t(`band_${l}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(bands).map(([construct, counts]) => (
            <tr key={construct}>
              <th scope="row" className="pr-2 text-left font-mono font-normal">
                {construct}
              </th>
              {levels.map((l) => (
                <td key={l} className="px-2 text-right tabular-nums">
                  {counts[l] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NextSection({ lesson, t }: { lesson: LessonDetail; t: T }) {
  const lines = lesson.nextTime.groups;
  return (
    <Section id="lesson-next" title={t("nextTitle")}>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noNext")}</p>
      ) : (
        <>
          {lesson.synthesis?.nextTime ? (
            <div>
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">{t("nextClass")}</h3>
              <p className="text-sm" data-testid="next-synthesis">
                {lesson.synthesis.nextTime}
              </p>
            </div>
          ) : null}
          <details className="text-sm" open={!lesson.synthesis?.nextTime}>
            <summary className="cursor-pointer text-muted-foreground">{t("nextGroups")}</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {lines.map((l) => (
                <li key={l.groupCode}>
                  <code className="font-mono text-xs">{l.groupCode}</code> {l.text}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </Section>
  );
}

function GroupsSection({ lesson, t }: { lesson: LessonDetail; t: T }) {
  return (
    <Section id="lesson-groups" title={t("groupsTitle")}>
      <ul className="flex flex-col divide-y divide-border" data-testid="lesson-groups">
        {lesson.groups.map((g) => (
          <li key={g.groupCode} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="flex flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-xs">{g.groupCode}</code>
                <span className="text-xs text-muted-foreground">{t("messages", { n: g.turns })}</span>
                {!g.summarised ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {t("notSummarised")}
                  </span>
                ) : null}
                {g.flags.map((f) => (
                  <span
                    key={f}
                    className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                  >
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    {t(`flag_${f}`)}
                  </span>
                ))}
              </div>
              {g.topConcept ? (
                <span className="text-xs text-muted-foreground">{t("topConcept", { concept: g.topConcept })}</span>
              ) : null}
            </div>
            <Link href={groupReportHref(lesson, g)} className="text-sm font-medium text-primary hover:underline">
              {t("openReport")}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
