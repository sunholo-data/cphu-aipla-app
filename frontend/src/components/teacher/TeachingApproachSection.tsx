"use client";

import Link from "next/link";
import { BookOpen, Radio } from "lucide-react";

import type { FidelityPayload } from "@/lib/teacherApi";

const copy = {
  heading: "Teaching approach",
  intro: (label: string) => `How the tutor used ${label} in this session.`,
  notAssessable: "Not assessed",
  drift: "Where it drifted",
  noDrift: "No departures from the approach stood out.",
  spoken: "Includes the group's recorded discussion.",
  readAbout: "Read about this approach",
  researcherHeading: "Construct detail (research instrument — fidelity, not quality)",
  construct: "Construct",
  band: "Band",
  rationale: "Rationale",
  evidence: "Turns",
  overall: "Overall",
} as const;

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
export function TeachingApproachSection({ fidelity }: { fidelity: FidelityPayload | null | undefined }) {
  if (!fidelity) return null;
  const label = fidelity.frameworkLabel ?? fidelity.frameworkId ?? "";
  return (
    <section
      aria-labelledby="approach-label"
      className="flex flex-col gap-2 rounded border border-border bg-background p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="approach-label" className="text-base font-semibold">
          {copy.heading}
          {label ? <span className="ml-2 font-normal text-muted-foreground">— {label}</span> : null}
        </h2>
        {fidelity.frameworkId ? (
          <Link
            href={`/project/tutors/${encodeURIComponent(fidelity.frameworkId)}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            {copy.readAbout}
          </Link>
        ) : null}
      </div>

      {fidelity.abstained ? (
        <p className="text-sm text-muted-foreground">
          {copy.notAssessable}
          {fidelity.abstainReason ? ` — ${fidelity.abstainReason}.` : "."}
        </p>
      ) : (
        <>
          {label ? <p className="text-xs text-muted-foreground">{copy.intro(label)}</p> : null}
          <p className="text-sm leading-relaxed">{fidelity.summary}</p>
          <div>
            <h3 className="text-xs font-medium uppercase text-muted-foreground">{copy.drift}</h3>
            {fidelity.drift.length > 0 ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                {fidelity.drift.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{copy.noDrift}</p>
            )}
          </div>
          {fidelity.spokenIncluded ? (
            <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Radio className="h-3 w-3" aria-hidden /> {copy.spoken}
            </p>
          ) : null}
          {fidelity.constructs ? <ConstructDetail fidelity={fidelity} /> : null}
        </>
      )}
    </section>
  );
}

function ConstructDetail({ fidelity }: { fidelity: FidelityPayload }) {
  const rows = Object.entries(fidelity.constructs ?? {});
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-muted-foreground">{copy.researcherHeading}</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pr-3 font-medium">{copy.construct}</th>
              <th className="pr-3 font-medium">{copy.band}</th>
              <th className="pr-3 font-medium">{copy.rationale}</th>
              <th className="font-medium">{copy.evidence}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, c]) => (
              <tr key={name} className="border-t border-border align-top">
                <td className="py-1 pr-3 font-mono">{name}</td>
                <td className="py-1 pr-3">
                  <BandChip band={c.band} />
                </td>
                <td className="py-1 pr-3">{c.rationale}</td>
                <td className="py-1 font-mono">{c.evidence.join(", ")}</td>
              </tr>
            ))}
            {fidelity.overallBand ? (
              <tr className="border-t border-border">
                <td className="py-1 pr-3 font-medium">{copy.overall}</td>
                <td className="py-1 pr-3">
                  <BandChip band={fidelity.overallBand} />
                </td>
                <td className="py-1 pr-3 text-muted-foreground" colSpan={2}>
                  {fidelity.model ?? ""}
                  {fidelity.evidenceSummary
                    ? ` · ${fidelity.evidenceSummary.tutor ?? 0} tutor / ${fidelity.evidenceSummary.student ?? 0} student turns`
                    : ""}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const BAND_STYLE: Record<string, string> = {
  strong: "bg-emerald-100 text-emerald-800",
  partial: "bg-amber-100 text-amber-800",
  absent: "bg-slate-100 text-slate-700",
};

function BandChip({ band }: { band: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 font-medium ${BAND_STYLE[band] ?? BAND_STYLE.absent}`}>{band}</span>
  );
}
