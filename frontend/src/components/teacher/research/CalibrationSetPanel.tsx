"use client";

import { useEffect, useState } from "react";
import { Download, Scale, TriangleAlert } from "lucide-react";

import { type AgreementCell, type CalibrationSet, fetchCalibrationSet } from "@/lib/teacherApi";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";
import { useT } from "@/i18n";

// Copy lives in messages/*/teacher-research.json (CalibrationSetPanel) — 1.1.108.
const NONE = "—";

function pct(cell: AgreementCell): string {
  return cell.agreement === null ? NONE : `${Math.round(cell.agreement * 100)}%`;
}

/** The set as JSONL — one example per line, the shape `make calibration-set` writes. */
export function toJsonl(set: CalibrationSet): string {
  return set.rows.map((r) => JSON.stringify(r)).join("\n") + (set.rows.length ? "\n" : "");
}

/**
 * Researcher corrections as a calibration set for the fidelity judge (1.1.148).
 *
 * M decided on 2026-10-08: corrections are SHARED among researchers and become
 * a calibration set. They stay annotation-only in effect — nothing here changes
 * a judgement or what the live judge reads; the set is what a later judge
 * revision is measured against. Agreement is shown per framework and construct
 * because "the judge is 70% right" hides which construct it gets wrong.
 *
 * ⚠️ A blank agreement is not 0%: with no comparable review there is nothing
 * to agree or disagree with, and the cell says so.
 */
export function CalibrationSetPanel() {
  const t = useT("CalibrationSetPanel");
  const [data, setData] = useState<CalibrationSet | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    fetchCalibrationSet()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setState("ok");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  const download = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([toJsonl(data)], { type: "application/x-ndjson" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `aipla-calibration-set-${data.generatedAt.slice(0, 10)}.jsonl`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <TeacherCard>
      <h2 className="flex items-center gap-2 text-base font-medium">
        <Scale className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        {t("title")}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("blurb")}</p>

      {state === "loading" ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("loading")}</p>
      ) : state === "error" || !data ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t("failed")}
        </p>
      ) : data.rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm" data-testid="calibration-overall">
            {t("overall", {
              n: data.stats.overall.n,
              agreement: pct(data.stats.overall),
              reviewers: data.stats.reviewers,
            })}
          </p>
          {data.stats.multiRated > 0 ? (
            <p className="text-xs text-muted-foreground">{t("multiRated", { n: data.stats.multiRated })}</p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">{t("colFramework")}</th>
                  <th className="py-1 pr-3 font-medium">{t("colConstruct")}</th>
                  <th className="py-1 pr-3 text-right font-medium">{t("colReviews")}</th>
                  <th className="py-1 pr-3 text-right font-medium">{t("colAgreement")}</th>
                  <th className="py-1 pr-3 text-right font-medium">{t("colHigher")}</th>
                  <th className="py-1 text-right font-medium">{t("colLower")}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.stats.byConstruct).flatMap(([fw, constructs]) =>
                  Object.entries(constructs).map(([key, cell]) => (
                    <tr key={`${fw}:${key}`} className="border-t border-border">
                      <td className="py-1.5 pr-3">{fw}</td>
                      <td className="py-1.5 pr-3">{key}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{cell.n}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{pct(cell)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{cell.researcherHigher}</td>
                      <td className="py-1.5 text-right tabular-nums">{cell.researcherLower}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{t("readOnly")}</p>
          <button
            type="button"
            onClick={download}
            className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t("download", { n: data.rows.length })}
          </button>
        </div>
      )}
    </TeacherCard>
  );
}
