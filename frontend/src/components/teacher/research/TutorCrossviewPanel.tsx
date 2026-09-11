"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Microscope, TriangleAlert } from "lucide-react";

import { type CrossviewApproach, type TutorCrossview, fetchTutorCrossview } from "@/lib/teacherApi";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";

/** UI copy, lifted out of JSX (1.1.108 M4) so a translator can reach it. */
const copy = {
  title: "Everything that teaches, and how much it is used",
  blurb:
    "Every approach in the system — the seven from the literature and everything teachers have written — with who authored it and what it has actually taught.",
  loading: "Loading…",
  failed: "Could not read the tutor catalogue. This is a failed read, not an empty one.",
  colApproach: "Approach",
  colAuthor: "Author",
  colStatus: "Status",
  colAssigned: "Tutors",
  colTurns: "Turns taught",
  published: "From the literature",
  authored: "Written by teachers and researchers",
  noneAuthored: "Nobody has written a custom approach yet.",
  usageUnavailable:
    "Usage could not be read from the chat log, so the turn counts are blank rather than zero — “never used” and “could not read” are different facts.",
  intentVsUse:
    "“Tutors” counts how many tutors name an approach; “Turns taught” counts what actually happened. An approach assigned once and never run shows 1 and 0.",
  variants: (n: number) =>
    n === 0
      ? "No tutor variants exist yet. The mechanism is built and unused — which is a different thing from not built."
      : `${n} tutor variant${n === 1 ? "" : "s"}.`,
  byTeacher: "teacher",
  byResearcher: "researcher",
  none: "—",
  unused: "0",
  readThem: (n: number) => `Read the ${n} turn${n === 1 ? "" : "s"} this approach taught`,
} as const;

function ApproachTable({ rows, usageAvailable }: { rows: CrossviewApproach[]; usageAvailable: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="py-1 pr-3 font-medium">{copy.colApproach}</th>
            <th className="py-1 pr-3 font-medium">{copy.colAuthor}</th>
            <th className="py-1 pr-3 font-medium">{copy.colStatus}</th>
            <th className="py-1 pr-3 text-right font-medium">{copy.colAssigned}</th>
            <th className="py-1 text-right font-medium">{copy.colTurns}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-t border-border">
              <td className="py-1.5 pr-3">
                {a.label}
                {a.register ? (
                  <span className="ml-1.5 text-xs text-muted-foreground">· {a.register}</span>
                ) : null}
              </td>
              <td className="py-1.5 pr-3 text-xs text-muted-foreground">
                {a.authorRole ? (a.authorRole === "teacher" ? copy.byTeacher : copy.byResearcher) : copy.none}
              </td>
              <td className="py-1.5 pr-3 text-xs">{a.status}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{a.tutorsAssigned}</td>
              {/* null (unreadable) renders blank; 0 renders 0.
                  A non-zero count is a LINK into those conversations — "what
                  does this approach actually produce" needs the approach and
                  its transcripts, and they lived on two unlinked pages until
                  2026-09-11. */}
              <td className="py-1.5 text-right tabular-nums">
                {!usageAvailable || a.turns === null ? (
                  copy.none
                ) : a.turns > 0 ? (
                  <Link
                    href={`/teacher/research/logs?approach=${encodeURIComponent(a.id)}`}
                    title={copy.readThem(a.turns)}
                    className="text-brand underline-offset-2 hover:underline"
                  >
                    {a.turns}
                  </Link>
                ) : (
                  a.turns
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Researchers see what teachers build (1.1.91 M4).
 *
 * The `scope=all` pattern applied to the tutor layer. Read-only; the server tags
 * the span `auth.researcher_bypass`, so who read whose work stays answerable —
 * and the teacher's own panel says the read exists, because this is their
 * professional work and the trust-card principle applies to them too.
 *
 * ⚠️ **Intent and use are separate columns, deliberately.** "Tutors" counts how
 * many tutors NAME an approach; "Turns taught" counts what actually happened. An
 * approach assigned in March and never run would otherwise read as busy.
 *
 * ⚠️ **A blank turn count is not a zero.** When the chat log cannot be read the
 * column is blank and the panel says so — "never used" is a finding about an
 * approach, "could not read" is a fact about a query, and rendering the second
 * as the first is the deploy-status footgun in a research column.
 */
export function TutorCrossviewPanel() {
  const [data, setData] = useState<TutorCrossview | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    fetchTutorCrossview()
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

  return (
    <TeacherCard>
      <h2 className="flex items-center gap-2 text-base font-medium">
        <Microscope className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        {copy.title}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{copy.blurb}</p>

      {state === "loading" ? (
        <p className="mt-3 text-sm text-muted-foreground">{copy.loading}</p>
      ) : state === "error" || !data ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {copy.failed}
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {!data.usageAvailable ? (
            <p
              role="status"
              className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
            >
              {copy.usageUnavailable}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{copy.intentVsUse}</p>

          <div>
            <p className="mb-1 text-xs font-medium">{copy.published}</p>
            <ApproachTable rows={data.publishedApproaches} usageAvailable={data.usageAvailable} />
          </div>

          <div>
            <p className="mb-1 text-xs font-medium">{copy.authored}</p>
            {data.authoredApproaches.length === 0 ? (
              <p className="text-sm text-muted-foreground">{copy.noneAuthored}</p>
            ) : (
              <ApproachTable rows={data.authoredApproaches} usageAvailable={data.usageAvailable} />
            )}
          </div>

          <p className="text-xs text-muted-foreground">{copy.variants(data.variantCount)}</p>
        </div>
      )}
    </TeacherCard>
  );
}
