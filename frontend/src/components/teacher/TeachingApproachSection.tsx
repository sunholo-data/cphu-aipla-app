"use client";

import Link from "next/link";
import { BookOpen, Radio } from "lucide-react";

import type { FidelityPayload } from "@/lib/teacherApi";
import { FidelityConstructDetail } from "@/components/teacher/FidelityConstructDetail";
import { useT } from "@/i18n";


/**
 * TeachingApproachSection (1.1.107 M5) — the report's read of how faithfully
 * the tutor followed the ONE approach the session ran under. Only that
 * approach: a teacher wants to know whether the ESRU tutor did ESRU, not that
 * the session also scores 40% as POE.
 *
 * Teachers see PROSE — what it looked like, where it drifted. Bands and the
 * per-construct table render only when the payload carries them, which the
 * backend does for a researcher alone: fit is not quality, and a number about
 * a teacher's own tutor must not read as a grade of the teacher.
 */
export function TeachingApproachSection({
  fidelity,
  sessionId,
  onCiteTurn,
}: {
  fidelity: FidelityPayload | null | undefined;
  /** The session the read judged — for the researcher's run comparison. */
  sessionId?: string | null;
  /** Open the transcript at turn `#N` (1.1.148 M3). */
  onCiteTurn?: (turn: number) => void;
}) {
  const t = useT("TeachingApproachSection");
  if (!fidelity) return null;
  const label = fidelity.frameworkLabel ?? fidelity.frameworkId ?? "";
  return (
    <section
      aria-labelledby="approach-label"
      className="flex flex-col gap-2 rounded border border-border bg-background p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="approach-label" className="text-base font-semibold">
          {t("heading")}
          {label ? <span className="ml-2 font-normal text-muted-foreground">— {label}</span> : null}
        </h2>
        {fidelity.frameworkId ? (
          <Link
            href={`/project/tutors/${encodeURIComponent(fidelity.frameworkId)}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            {t("readAbout")}
          </Link>
        ) : null}
      </div>

      {fidelity.abstained ? (
        <p className="text-sm text-muted-foreground">
          {fidelity.abstainReason ? t("abstainReason", { reason: fidelity.abstainReason }) : `${t("notAssessable")}.`}
        </p>
      ) : (
        <>
          {label ? <p className="text-xs text-muted-foreground">{t("intro", { label })}</p> : null}
          <p className="text-sm leading-relaxed">{fidelity.summary}</p>
          <div>
            <h3 className="text-xs font-medium uppercase text-muted-foreground">{t("drift")}</h3>
            {fidelity.drift.length > 0 ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                {fidelity.drift.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{t("noDrift")}</p>
            )}
          </div>
          {fidelity.spokenIncluded ? (
            <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Radio className="h-3 w-3" aria-hidden /> {t("spoken")}
            </p>
          ) : null}
          {fidelity.constructs ? (
            <FidelityConstructDetail fidelity={fidelity} sessionId={sessionId} onCiteTurn={onCiteTurn} />
          ) : null}
        </>
      )}
    </section>
  );
}
