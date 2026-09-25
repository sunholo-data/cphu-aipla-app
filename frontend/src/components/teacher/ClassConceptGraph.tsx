"use client";

// ClassConceptGraph — one picture of a class's concepts across the year
// (CONCEPT-2 M5), from GET /api/classes/{id}/concept-rollup.
//
// The rule this surface exists to honour: a class's standing on a concept is
// the SPREAD of its groups, never a union. A node where three groups have the
// concept and three have not is the interesting node — it is where a teacher
// intervenes, and (M7) where two groups are worth pairing — so it renders as a
// proportional bar rather than one winning colour.
//
// "Never met it" is kept apart from "has not shown it" all the way to the
// screen. They are different facts about a class: one is a gap in coverage, the
// other a gap in understanding, and they call for opposite responses.

import { useEffect, useState } from "react";

import { ConceptMapGraph, type ConceptGroupSpread } from "@/components/workspace/ConceptMapGraph";
import { fetchWithTeacherAuth } from "@/lib/apiClient";

type Status = "not_yet" | "partial" | "demonstrated";

interface RollupConcept {
  concept: string;
  key: string;
  byGroup: Record<string, Status>;
  counts: { not_yet: number; partial: number; demonstrated: number };
  activityIds: string[];
  /** CONCEPT-2 M6 — conflicts INSIDE one group's evidence. Groups differing
   *  from each other is the class's shape, not a conflict, and is never here. */
  flags: { groupId: string; kind: "provenance" | "regressed" }[];
}

interface Rollup {
  classId: string;
  groups: string[];
  classGroups: string[];
  concepts: RollupConcept[];
  edges: { from: string; to: string }[];
}

const STATUS_COPY: Record<string, string> = {
  demonstrated: "forstået",
  partial: "på vej",
  not_yet: "ikke vist endnu",
};

const FLAG_COPY: Record<string, string> = {
  provenance: "AI'ens løbende og dens tjek er uenige",
  regressed: "er gået tilbage siden sidst",
};

const OVERRIDE_CHOICES: { status: Status; label: string }[] = [
  { status: "demonstrated", label: "forstået" },
  { status: "partial", label: "på vej" },
  { status: "not_yet", label: "ikke vist endnu" },
];

export function ClassConceptGraph({ classId }: { classId: string }) {
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetchWithTeacherAuth(`/api/proxy/api/classes/${classId}/concept-rollup`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Rollup;
        if (alive) {
          setRollup(body);
          setState("ready");
        }
      } catch {
        // A concept graph that fails to load must never take the class page
        // with it — every other section on this page still works.
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [classId, reload]);

  /** Record the teacher's own read. Written as `kind="teacher"` server-side,
   *  which outranks every AI record and is never overwritten by one. */
  async function override(concept: string, groupId: string, status: Status) {
    setSaving(`${groupId}:${status}`);
    try {
      const res = await fetchWithTeacherAuth(`/api/proxy/api/classes/${classId}/concept-override`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concept, groupId, status }),
      });
      // Re-read rather than patching local state: the server writes to every
      // activity that maps the concept, so what a teacher should see back is
      // the store's answer, not our guess at it.
      if (res.ok) setReload((n) => n + 1);
    } finally {
      setSaving(null);
    }
  }

  if (state === "loading") return <p className="text-sm text-muted-foreground">Indlæser begrebskort…</p>;
  if (state === "error" || !rollup) {
    return <p className="text-sm text-muted-foreground">Begrebskortet kunne ikke hentes lige nu.</p>;
  }
  if (rollup.concepts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="class-concept-empty">
        Ingen begreber er krydset af endnu. De dukker op her, efterhånden som grupperne arbejder med
        aktiviteter, der har et begrebskort.
      </p>
    );
  }

  const total = rollup.classGroups.length || rollup.groups.length;
  const spread: Record<string, ConceptGroupSpread> = {};
  for (const c of rollup.concepts) {
    const seen = Object.keys(c.byGroup).length;
    spread[c.key] = {
      demonstrated: c.counts.demonstrated,
      partial: c.counts.partial,
      not_yet: c.counts.not_yet,
      // A group the class has but that has no record for THIS concept. Derived
      // here rather than server-side because only the caller holds the class's
      // roster; the rollup deliberately reports what it can see.
      notSeen: Math.max(0, total - seen),
    };
  }

  const chosen = rollup.concepts.find((c) => c.key === selected) ?? null;

  return (
    <div className="flex flex-col gap-3" data-testid="class-concept-graph">
      <p className="text-xs text-muted-foreground">
        Hver kasse er et begreb, klassens aktiviteter har kortlagt. Bjælken viser, hvordan grupperne
        fordeler sig — ikke et gennemsnit. Klik på et begreb for at se hvem.
      </p>

      <div className="overflow-x-auto rounded-md border border-border bg-background p-2">
        <ConceptMapGraph
          nodes={rollup.concepts.map((c) => ({ id: c.key, label: c.concept }))}
          edges={rollup.edges}
          nodeSpread={spread}
          onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
          selectedId={selected}
        />
      </div>

      <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <Legend className="bg-emerald-500" label="forstået" />
        <Legend className="bg-amber-400" label="på vej" />
        <Legend className="bg-slate-400" label="ikke vist endnu" />
        <Legend className="bg-slate-200" label="har ikke mødt begrebet" />
      </ul>

      {chosen ? (
        <div className="rounded-md border border-border p-3 text-sm" data-testid="class-concept-detail">
          <h3 className="font-medium">{chosen.concept}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Kortlagt i {chosen.activityIds.length} aktivitet{chosen.activityIds.length === 1 ? "" : "er"}.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {rollup.classGroups.map((group) => {
              const flags = chosen.flags.filter((f) => f.groupId === group);
              return (
                <li key={group} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs">{group}</span>
                    <span className="text-xs text-muted-foreground">
                      {chosen.byGroup[group] ? STATUS_COPY[chosen.byGroup[group]] : "har ikke mødt begrebet"}
                    </span>
                    {flags.map((f) => (
                      <span
                        key={f.kind}
                        data-testid={`flag-${group}-${f.kind}`}
                        className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900"
                      >
                        {FLAG_COPY[f.kind]}
                      </span>
                    ))}
                  </span>
                  <span className="flex gap-1">
                    {OVERRIDE_CHOICES.map((choice) => (
                      <button
                        key={choice.status}
                        type="button"
                        disabled={saving !== null}
                        aria-label={`Sæt ${chosen.concept} til ${choice.label} for ${group}`}
                        onClick={() => void override(chosen.concept, group, choice.status)}
                        className="rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50"
                      >
                        {choice.label}
                      </button>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Din vurdering vejer tungere end AI&apos;ens og bliver ikke overskrevet af den. Tutoren får at
            vide, at begrebet er afgjort, og skal ikke teste det igen.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={`inline-block h-2 w-4 rounded-sm ${className}`} aria-hidden="true" />
      {label}
    </li>
  );
}
