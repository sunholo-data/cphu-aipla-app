"use client";

// ClassGroupPairings — which groups in this class would have something to give
// each other (CONCEPT-2 M7), from GET /api/classes/{id}/group-pairings.
//
// M, 2026-09-25: "we want to help link groups that are mastering different
// trees of the class levels". This is the payoff of refusing to flatten the
// class into a union at M4 — a class average has no pairings in it.
//
// ⚠️ This panel names the CONCEPT a pair would exchange and nothing else. No
// score, no standing, no "group A is ahead". That framing is one careless
// change away from "which groups are behind", and a class can read a teacher's
// screen. It is teacher-facing only and there is no student route to it.

import { useEffect, useState } from "react";

import { fetchWithTeacherAuth } from "@/lib/apiClient";

interface Pair {
  groups: [string, string] | string[];
  aGives: string[];
  bGives: string[];
  mutual: boolean;
}

export function ClassGroupPairings({ classId }: { classId: string }) {
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetchWithTeacherAuth(`/api/proxy/api/classes/${classId}/group-pairings`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { pairs: Pair[] };
        if (alive) setPairs(body.pairs);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [classId]);

  if (failed) return <p className="text-sm text-muted-foreground">Forslagene kunne ikke hentes lige nu.</p>;
  if (pairs === null) return <p className="text-sm text-muted-foreground">Indlæser forslag…</p>;
  if (pairs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="pairings-empty">
        Ingen forslag endnu — de dukker op, når grupperne har krydset forskellige begreber af.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="class-group-pairings">
      <p className="text-xs text-muted-foreground">
        Grupper, der står forskellige steder og kan give hinanden noget. Forslag til hvem der kunne tale
        sammen — ikke en rangliste.
      </p>
      <ul className="flex flex-col gap-2">
        {pairs.map((pair) => {
          const [a, b] = pair.groups;
          return (
            <li key={`${a}-${b}`} data-testid={`pairing-${a}-${b}`} className="rounded-md border border-border p-2.5">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="font-mono text-xs">{a}</span>
                <span aria-hidden="true">{pair.mutual ? "↔" : "→"}</span>
                <span className="font-mono text-xs">{b}</span>
                {pair.mutual ? (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-normal text-emerald-800">
                    kan bytte
                  </span>
                ) : null}
              </p>
              {pair.aGives.length > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {a} kan forklare: {pair.aGives.join(", ")}
                </p>
              ) : null}
              {pair.bGives.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {b} kan forklare: {pair.bGives.join(", ")}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
