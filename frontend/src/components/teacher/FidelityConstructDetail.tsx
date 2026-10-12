"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, History, Pencil, Quote } from "lucide-react";

import {
  listFidelityRuns,
  listRubricReviews,
  postRubricReview,
  type FidelityCitation,
  type FidelityConstruct,
  type FidelityCriterion,
  type FidelityPayload,
  type FidelityRunHistory,
  type FidelityRunRow,
  type RubricReview,
  type RubricReviews,
} from "@/lib/teacherApi";
import { useT, type Translate } from "@/i18n";

type T = Translate<"TeachingApproachSection">;
const BANDS = ["strong", "partial", "absent"] as const;

/**
 * The researcher's "show the working" view of a fidelity run (1.1.148 M2–M5).
 *
 * Built from what confused researchers at the 2026-10-05 seminar: a bare
 * "Data: partial, 19, 43, 47" read as the STUDENT's data use scored from three
 * student turns, the numbers matched no transcript row, the same session had
 * been judged three times with different results, and nothing said what the
 * band meant. So this view says, in order: what is judged (the tutor's moves),
 * how to read a row (one band per construct; the turns it rests on), the
 * criteria the judge was given, each cited turn as the transcript's own `#N`
 * with the words quoted — clickable — and every other run of the session.
 *
 * Researcher-only by payload: the backend sends `constructs` to a researcher
 * alone, and every request here goes to a researcher-only route.
 */
export function FidelityConstructDetail({
  fidelity,
  sessionId,
  onCiteTurn,
}: {
  fidelity: FidelityPayload;
  sessionId?: string | null;
  onCiteTurn?: (turn: number) => void;
}) {
  const t = useT("TeachingApproachSection");
  const [open, setOpen] = useState(false);
  const [reviews, setReviews] = useState<RubricReviews | null>(null);
  const [reviewsFailed, setReviewsFailed] = useState(false);
  const runId = fidelity.runId ?? null;

  const loadReviews = useCallback(async () => {
    if (!runId) return;
    try {
      setReviews(await listRubricReviews(runId));
      setReviewsFailed(false);
    } catch {
      setReviewsFailed(true);
    }
  }, [runId]);

  useEffect(() => {
    if (open) void loadReviews();
  }, [open, loadReviews]);

  const rows = Object.entries(fidelity.constructs ?? {});
  const label = fidelity.frameworkLabel ?? fidelity.frameworkId ?? "";
  return (
    <details className="mt-1" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-xs text-muted-foreground">{t("researcherHeading")}</summary>
      <div className="mt-2 flex flex-col gap-3 text-xs">
        <p className="rounded border border-border bg-muted/40 px-3 py-2 text-sm font-medium">
          {t("judgesHeader", { label })}
        </p>
        <Legend fidelity={fidelity} t={t} />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pr-3 font-medium">{t("construct")}</th>
                <th className="pr-3 font-medium">{t("band")}</th>
                <th className="pr-3 font-medium">{t("rationale")}</th>
                <th className="font-medium">{t("evidence")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([key, c]) => (
                <ConstructRow
                  key={key}
                  constructKey={key}
                  c={c}
                  criterion={fidelity.criteria?.[key]}
                  runId={runId}
                  reviews={reviews}
                  onReviewed={setReviews}
                  onCiteTurn={onCiteTurn}
                  t={t}
                />
              ))}
              {fidelity.overallBand ? (
                <tr className="border-t border-border">
                  <td className="py-1 pr-3 font-medium">{t("overall")}</td>
                  <td className="py-1 pr-3">
                    <BandChip band={fidelity.overallBand} />
                  </td>
                  <td className="py-1 pr-3 text-muted-foreground" colSpan={2}>
                    {fidelity.model ?? ""}
                    {fidelity.evidenceSummary
                      ? ` · ${t("turns", {
                          tutor: Number(fidelity.evidenceSummary.tutor ?? 0),
                          student: Number(fidelity.evidenceSummary.student ?? 0),
                        })}`
                      : ""}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {reviewsFailed ? <p className="text-destructive">{t("reviewsFailed")}</p> : null}
        {fidelity.notAssessed && Object.keys(fidelity.notAssessed).length > 0 ? (
          <div>
            <h4 className="font-medium text-muted-foreground">{t("notAssessedHeading")}</h4>
            <ul className="list-disc pl-5">
              {Object.entries(fidelity.notAssessed).map(([k, why]) => (
                <li key={k}>
                  <span className="font-mono">{k}</span> — {why}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {sessionId ? <RunsPanel sessionId={sessionId} current={fidelity} onCiteTurn={onCiteTurn} t={t} /> : null}
      </div>
    </details>
  );
}

function Legend({ fidelity, t }: { fidelity: FidelityPayload; t: T }) {
  const criteria =
    !fidelity.criteriaVersion || fidelity.criteriaVersion === "yaml"
      ? t("criteriaPublished")
      : t("criteriaVersion", { v: fidelity.criteriaVersion });
  return (
    <div className="flex flex-col gap-1 text-muted-foreground">
      <p>
        <strong className="text-foreground">{t("band")}</strong> — {t("legendBand")}
      </p>
      <p>
        <strong className="text-foreground">{t("evidence")}</strong> — {t("legendEvidence")}
      </p>
      <details>
        <summary className="cursor-pointer">{t("ruleHeading")}</summary>
        <ul className="mt-1 list-disc pl-5">
          <li>{t("ruleStrong")}</li>
          <li>{t("rulePartial")}</li>
          <li>{t("ruleAbsent")}</li>
          <li>{t("ruleOverall")}</li>
        </ul>
      </details>
      <p>
        {t("runMeta", {
          prompt: fidelity.promptVersion,
          criteria,
          model: fidelity.model || "—",
          when: fidelity.scoredAt ? fidelity.scoredAt.slice(0, 16).replace("T", " ") : "—",
        })}
        {typeof fidelity.basedOnMessageCount === "number" && typeof fidelity.sessionMessageCount === "number"
          ? ` ${t("basedOn", { n: fidelity.basedOnMessageCount, total: fidelity.sessionMessageCount })}`
          : ""}
      </p>
      {fidelity.criteriaChanged ? (
        <p className="flex items-start gap-1 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {t("criteriaChanged", {
            current:
              fidelity.currentCriteriaVersion === "yaml"
                ? t("criteriaPublished")
                : t("criteriaVersion", { v: fidelity.currentCriteriaVersion ?? "" }),
          })}
        </p>
      ) : null}
      {fidelity.idScheme === "position-translated" ? <p>{t("idTranslated")}</p> : null}
      {fidelity.idScheme === "position" ? <p>{t("idPosition")}</p> : null}
    </div>
  );
}

function ConstructRow({
  constructKey,
  c,
  criterion,
  runId,
  reviews,
  onReviewed,
  onCiteTurn,
  t,
}: {
  constructKey: string;
  c: FidelityConstruct;
  criterion?: FidelityCriterion;
  runId: string | null;
  reviews: RubricReviews | null;
  onReviewed: (r: RubricReviews) => void;
  onCiteTurn?: (turn: number) => void;
  t: T;
}) {
  const [correcting, setCorrecting] = useState(false);
  const mine = (reviews?.reviews ?? []).filter((r) => r.construct_key === constructKey);
  const eff = reviews?.effective?.[constructKey];
  const latest = mine.length > 0 ? mine[mine.length - 1] : null;
  return (
    <tr className="border-t border-border align-top">
      <td className="py-1 pr-3">
        <span className="font-mono">{constructKey}</span>
        {criterion ? <CriterionView criterion={criterion} cited={c.moves ?? []} t={t} /> : null}
      </td>
      <td className="py-1 pr-3">
        <div className="flex flex-col items-start gap-1">
          <span className="text-[10px] uppercase text-muted-foreground">{t("aiRead")}</span>
          <BandChip band={c.band} />
          {eff?.source === "review" ? (
            <>
              <span className="text-[10px] uppercase text-muted-foreground">{t("correction")}</span>
              <BandChip band={eff.band ?? "absent"} />
            </>
          ) : null}
        </div>
      </td>
      <td className="py-1 pr-3">
        <p>{c.rationale}</p>
        {c.downgraded ? <p className="mt-1 text-amber-700 dark:text-amber-400">{t("downgraded")}</p> : null}
        {latest ? (
          <div className="mt-1 rounded border border-border bg-muted/30 p-1.5">
            <p>
              {t("reviewLine", {
                band: latest.band,
                reason: latest.reason,
                who: latest.reviewer_email || latest.reviewer_uid,
                when: latest.created_at.slice(0, 16).replace("T", " "),
              })}
            </p>
            {eff?.reviewedAgainstEarlier ? (
              <p className="text-amber-700 dark:text-amber-400">{t("reviewedEarlier")}</p>
            ) : null}
            {mine.length > 1 ? <ReviewHistory reviews={mine} t={t} /> : null}
          </div>
        ) : null}
        {runId ? (
          correcting ? (
            <ReviewForm
              runId={runId}
              constructKey={constructKey}
              judgedBand={c.band}
              judgedTurns={c.evidence.map((e) => e.transcriptTurn ?? e.turn)}
              supersedes={latest?.review_id ?? null}
              onDone={(r) => {
                setCorrecting(false);
                if (r) onReviewed(r);
              }}
              t={t}
            />
          ) : (
            <button
              type="button"
              onClick={() => setCorrecting(true)}
              className="mt-1 inline-flex items-center gap-1 rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Pencil className="h-3 w-3" aria-hidden /> {t("correct")}
            </button>
          )
        ) : null}
      </td>
      <td className="py-1">
        <Citations c={c} onCiteTurn={onCiteTurn} t={t} />
      </td>
    </tr>
  );
}

function CriterionView({ criterion, cited, t }: { criterion: FidelityCriterion; cited: string[]; t: T }) {
  return (
    <details className="mt-0.5">
      <summary className="cursor-pointer text-[11px] text-muted-foreground">{t("criterion")}</summary>
      <div className="mt-1 flex max-w-xs flex-col gap-1 text-[11px]">
        {criterion.summary ? <p>{criterion.summary}</p> : null}
        {criterion.moves.length > 0 ? (
          <>
            <p className="font-medium">{t("criterionMoves")}</p>
            <ul className="flex flex-col gap-0.5">
              {criterion.moves.map((m) => (
                <li key={m.id} className={cited.includes(m.id) ? "font-medium text-foreground" : "text-muted-foreground"}>
                  <span className="font-mono">[{m.id}]</span> {m.text}
                  {cited.includes(m.id) ? (
                    <span className="ml-1 rounded bg-emerald-100 px-1 text-emerald-800">{t("citedMove")}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {criterion.avoid.length > 0 ? (
          <>
            <p className="font-medium">{t("criterionAvoid")}</p>
            <ul className="list-disc pl-4 text-muted-foreground">
              {criterion.avoid.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </>
        ) : null}
        {criterion.evaluationHint ? (
          <p>
            <span className="font-medium">{t("criterionHint")}</span> {criterion.evaluationHint}
          </p>
        ) : null}
      </div>
    </details>
  );
}

/** Each cited turn as the transcript's own `#N` and what was said there —
 *  never a bare integer. A citation with no honest transcript number renders
 *  without a link; one outside the scored dialogue is listed apart. */
export function Citations({
  c,
  onCiteTurn,
  t,
}: {
  c: FidelityConstruct;
  onCiteTurn?: (turn: number) => void;
  t: T;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {c.evidence.map((e, i) => (
        <CitationItem key={`${e.turn}-${i}`} e={e} onCiteTurn={onCiteTurn} t={t} />
      ))}
      {c.rejectedEvidence && c.rejectedEvidence.length > 0 ? (
        <p className="text-muted-foreground">
          {t("rejected", { list: c.rejectedEvidence.map((r) => String(r.turn)).join(", ") })}
        </p>
      ) : null}
    </div>
  );
}

function CitationItem({ e, onCiteTurn, t }: { e: FidelityCitation; onCiteTurn?: (turn: number) => void; t: T }) {
  const n = e.transcriptTurn;
  const text = e.quote || e.snippet || "";
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        {n !== null && n !== undefined && onCiteTurn ? (
          <button
            type="button"
            onClick={() => onCiteTurn(n)}
            title={t("goToTurn", { n })}
            className="rounded bg-muted px-1 font-mono text-foreground underline-offset-2 hover:underline"
          >
            #{n}
          </button>
        ) : (
          <span className="rounded bg-muted px-1 font-mono">#{n ?? `${e.turn}?`}</span>
        )}
        {e.role ? <span className="text-muted-foreground">{e.role === "tutor" ? t("roleTutor") : t("roleStudent")}</span> : null}
      </div>
      {text ? (
        <p className="flex items-start gap-1">
          <Quote className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className={e.quote ? "italic" : "text-muted-foreground"}>{text}</span>
        </p>
      ) : null}
      {e.quote && e.verified === false ? (
        <span className="text-amber-700 dark:text-amber-400">{t("unverified")}</span>
      ) : null}
    </div>
  );
}

function ReviewHistory({ reviews, t }: { reviews: RubricReview[]; t: T }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-muted-foreground">{t("historyHeading", { n: reviews.length })}</summary>
      <ol className="mt-1 flex flex-col gap-0.5 pl-4">
        {reviews.map((r) => (
          <li key={r.review_id} className="list-decimal">
            {t("reviewLine", {
              band: r.band,
              reason: r.reason,
              who: r.reviewer_email || r.reviewer_uid,
              when: r.created_at.slice(0, 16).replace("T", " "),
            })}
            <span className="text-muted-foreground"> · {t("judgedThen", { band: r.judged?.band ?? "—" })}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function parseTurns(raw: string): number[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.replace(/^#/, ""))
    .filter((s) => /^\d+$/.test(s))
    .map(Number);
}

/** A correction: the COMPLETE review payload every time — band, turns, reason,
 *  and the review it supersedes. Create-only; there is nothing to edit. */
function ReviewForm({
  runId,
  constructKey,
  judgedBand,
  judgedTurns,
  supersedes,
  onDone,
  t,
}: {
  runId: string;
  constructKey: string;
  judgedBand: string;
  judgedTurns: number[];
  supersedes: string | null;
  onDone: (r: RubricReviews | null) => void;
  t: T;
}) {
  const [band, setBand] = useState<(typeof BANDS)[number]>(
    (BANDS as readonly string[]).includes(judgedBand) ? (judgedBand as (typeof BANDS)[number]) : "partial",
  );
  const [turns, setTurns] = useState(judgedTurns.map((n) => `#${n}`).join(", "));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const tooShort = reason.trim().length < 10;
  const submit = async () => {
    setSaving(true);
    setFailed(false);
    try {
      const r = await postRubricReview(runId, {
        constructKey,
        band,
        evidence: parseTurns(turns),
        reason: reason.trim(),
        supersedes,
      });
      onDone(r);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  const id = `review-${constructKey}`;
  return (
    <form
      className="mt-1 flex flex-col gap-1 rounded border border-border p-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!tooShort && !saving) void submit();
      }}
    >
      <label htmlFor={`${id}-band`} className="text-muted-foreground">
        {t("correctionBand")}
      </label>
      <select
        id={`${id}-band`}
        value={band}
        onChange={(e) => setBand(e.target.value as (typeof BANDS)[number])}
        className="rounded border border-border bg-background px-1 py-0.5"
      >
        {BANDS.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-turns`} className="text-muted-foreground">
        {t("correctionTurns")}
      </label>
      <input
        id={`${id}-turns`}
        value={turns}
        onChange={(e) => setTurns(e.target.value)}
        className="rounded border border-border bg-background px-1 py-0.5 font-mono"
      />
      <label htmlFor={`${id}-reason`} className="text-muted-foreground">
        {t("correctionReason")}
      </label>
      <textarea
        id={`${id}-reason`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        className="rounded border border-border bg-background px-1 py-0.5"
      />
      {failed ? <p className="text-destructive">{t("saveFailed")}</p> : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={tooShort || saving}
          className="rounded border border-border px-2 py-0.5 font-medium hover:bg-accent disabled:opacity-50"
        >
          {saving ? t("saving") : t("save")}
        </button>
        <button type="button" onClick={() => onDone(null)} className="px-2 py-0.5 text-muted-foreground">
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

/** Every judgement of this session, side by side (M0: one session was judged
 *  three times in a minute with different evidence, and only the last showed). */
function RunsPanel({
  sessionId,
  current,
  onCiteTurn,
  t,
}: {
  sessionId: string;
  current: FidelityPayload;
  onCiteTurn?: (turn: number) => void;
  t: T;
}) {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [history, setHistory] = useState<FidelityRunHistory | null>(null);
  const load = async () => {
    setState("loading");
    try {
      setHistory(await listFidelityRuns(sessionId));
      setState("ok");
    } catch {
      setState("error");
    }
  };
  const runs: FidelityRunRow[] =
    history && history.emissionsStatus === "ok" && history.emissions.length > 0 ? history.emissions : (history?.stored ?? []);
  const keys = Array.from(
    new Set([...Object.keys(current.constructs ?? {}), ...runs.flatMap((r) => Object.keys(r.constructs ?? {}))]),
  );
  return (
    <div className="flex flex-col gap-1">
      {state === "idle" ? (
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex w-fit items-center gap-1 rounded border border-border px-2 py-0.5 hover:bg-accent"
        >
          <History className="h-3 w-3" aria-hidden /> {t("runsButton")}
        </button>
      ) : null}
      {state === "loading" ? <p className="text-muted-foreground">{t("runsLoading")}</p> : null}
      {state === "error" ? <p className="text-destructive">{t("runsFailed")}</p> : null}
      {state === "ok" && history ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t("runsCount", { n: runs.length })}</p>
          {history.emissionsStatus === "unreadable" ? (
            <p className="text-muted-foreground">{t("runsMirrorUnreadable")}</p>
          ) : null}
          {runs.length > 1 ? <p className="text-muted-foreground">{t("runsCompareHint")}</p> : null}
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pr-3 font-medium">{t("construct")}</th>
                  {runs.map((r, i) => (
                    <th key={`${r.runId}-${i}`} className="pr-3 font-medium">
                      <span className="flex items-center gap-1">
                        <ChevronRight className="h-3 w-3" aria-hidden />
                        {(r.scoredAt ?? "").slice(0, 16).replace("T", " ") || "—"}
                      </span>
                      <span className="font-mono font-normal">{r.rubricVersion}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k} className="border-t border-border align-top">
                    <td className="py-1 pr-3 font-mono">{k}</td>
                    {runs.map((r, i) => {
                      const c = r.constructs?.[k];
                      return (
                        <td key={`${r.runId}-${i}`} className="py-1 pr-3">
                          {c ? (
                            <div className="flex flex-col gap-0.5">
                              <BandChip band={c.band} />
                              <span className="flex flex-wrap gap-1">
                                {c.evidence.map((e, j) =>
                                  e.transcriptTurn !== null && e.transcriptTurn !== undefined && onCiteTurn ? (
                                    <button
                                      key={j}
                                      type="button"
                                      onClick={() => onCiteTurn(e.transcriptTurn as number)}
                                      className="font-mono underline-offset-2 hover:underline"
                                    >
                                      #{e.transcriptTurn}
                                    </button>
                                  ) : (
                                    <span key={j} className="font-mono">
                                      #{e.transcriptTurn ?? `${e.turn}?`}
                                    </span>
                                  ),
                                )}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t border-border">
                  <td className="py-1 pr-3 font-medium">{t("overall")}</td>
                  {runs.map((r, i) => (
                    <td key={`${r.runId}-${i}`} className="py-1 pr-3">
                      {r.overallBand ? <BandChip band={r.overallBand} /> : <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Transcript `#N` → the constructs that cite it — the "cited by" badges on the
 *  transcript (1.1.148 M3). Empty for a teacher's payload, which carries no
 *  constructs, so a teacher's transcript never shows a badge. */
export function citationsByTurn(fidelity: FidelityPayload | null | undefined): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const [key, c] of Object.entries(fidelity?.constructs ?? {})) {
    for (const e of c.evidence ?? []) {
      const n = e.transcriptTurn;
      if (n === null || n === undefined) continue;
      const list = (out[n] ??= []);
      if (!list.includes(key)) list.push(key);
    }
  }
  return out;
}

const BAND_STYLE: Record<string, string> = {
  strong: "bg-emerald-100 text-emerald-800",
  partial: "bg-amber-100 text-amber-800",
  absent: "bg-slate-100 text-slate-700",
};

export function BandChip({ band }: { band: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 font-medium ${BAND_STYLE[band] ?? BAND_STYLE.absent}`}>{band}</span>
  );
}
