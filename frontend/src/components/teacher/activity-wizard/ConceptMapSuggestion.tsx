"use client";

import { ChevronDown, Network } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { applyConceptMapDiff } from "@/app/teacher/activities/applyConceptMapDiff";
import { ConceptMapEditor, type ConceptMapEditorValue } from "@/components/teacher/ConceptMapEditor";
import { removeKind } from "@/components/teacher/WorkspaceElements";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import type { ActivityBuilder } from "@/hooks/useActivityBuilder";
import { useT } from "@/i18n";
import { type SuggestedConceptMap, suggestConceptMap } from "@/lib/teacherApi";

/** Ask once the goal says enough to plan from — roughly a sentence. */
export const SUGGEST_MIN_WORDS = 8;
/** …and once the teacher has paused typing for this long (or left the field). */
export const SUGGEST_DEBOUNCE_MS = 1500;

export type SuggestState =
  | { status: "idle" }
  | { status: "loading"; goal: string }
  | { status: "ready"; goal: string; map: SuggestedConceptMap }
  | { status: "error"; goal: string };

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** The builder holds a map with at least one named concept (used, or from a template). */
export function hasConcepts(b: ActivityBuilder): boolean {
  return Boolean(b.conceptMap?.nodes.some((n) => n.label.trim()));
}

/** The suggested wire map as the editor's state — through the same Apply the
 *  co-pilot's proposals take, so ids and "builds on" land identically. */
export function suggestionToEditorValue(map: SuggestedConceptMap, nextKey: () => number): ConceptMapEditorValue {
  return applyConceptMapDiff(
    null,
    {
      title: map.title,
      addNodes: map.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        doneWhen: n.doneWhen,
        checkQuestions: n.checkQuestions,
      })),
      addEdges: map.edges,
    },
    nextKey,
  );
}

export interface ConceptMapSuggestionApi {
  state: SuggestState;
  /** The teacher left the goal field: ask now instead of after the pause. */
  flush: () => void;
  /** Ask again for the current goal (Make a new one / Try again / manual ask). */
  requestNow: () => void;
}

/**
 * The suggestion's request lifecycle (wizard step 1). Asks when the goal has at
 * least `SUGGEST_MIN_WORDS` words and the builder holds no concepts, after a
 * `SUGGEST_DEBOUNCE_MS` pause or on blur; never twice for the same goal; one
 * request in flight at a time (a newer one aborts it), and a late answer for
 * an older goal is dropped.
 *
 * `enabled` is the concept-map flag (off → never asks). `auto` is the teacher's
 * "start new activities with a concept map" default: off → only asks when the
 * teacher presses the button.
 */
export function useConceptMapSuggestion(
  b: ActivityBuilder,
  { enabled, auto }: { enabled: boolean; auto: boolean },
): ConceptMapSuggestionApi {
  const [state, setState] = useState<SuggestState>({ status: "idle" });
  const seq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const asked = useRef<string | null>(null);
  // Read at request time, so the callback need not change on every keystroke.
  const latest = useRef(b);
  latest.current = b;

  const goal = b.teachingGoal.trim();
  const eligible = enabled && !hasConcepts(b) && wordCount(goal) >= SUGGEST_MIN_WORDS;

  const request = useCallback(
    (g: string) => {
      if (!enabled || !g) return;
      const id = ++seq.current;
      inFlight.current?.abort();
      const ctl = new AbortController();
      inFlight.current = ctl;
      asked.current = g;
      setState({ status: "loading", goal: g });
      const cur = latest.current;
      suggestConceptMap({ goal: g, language: cur.language, title: cur.title.trim() || undefined }, ctl.signal)
        .then((res) => {
          if (id !== seq.current) return; // a newer goal was asked for
          setState(res.ok ? { status: "ready", goal: g, map: res.map } : { status: "error", goal: g });
        })
        .catch(() => {
          if (id !== seq.current) return;
          setState({ status: "error", goal: g });
        })
        .finally(() => {
          if (inFlight.current === ctl) inFlight.current = null;
        });
    },
    [enabled],
  );

  useEffect(() => {
    if (!auto || !eligible || goal === asked.current) return;
    const timer = setTimeout(() => {
      if (asked.current !== goal) request(goal);
    }, SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [auto, eligible, goal, request]);

  useEffect(
    () => () => {
      seq.current++;
      inFlight.current?.abort();
    },
    [],
  );

  const flush = useCallback(() => {
    if (auto && eligible && asked.current !== goal) request(goal);
  }, [auto, eligible, goal, request]);

  const requestNow = useCallback(() => request(goal), [goal, request]);

  return { state, flush, requestNow };
}

/**
 * Wizard step 1's concept-map card (2026-11-12): a map suggested from the goal,
 * which the teacher uses, edits or asks again for — or the map the activity
 * already holds (used, or from a template), with Edit and Remove. A suggestion
 * that cannot be made is one quiet line with Try again; it never blocks Next.
 */
export function ConceptMapCard({
  builder: b,
  suggestion,
  auto,
}: {
  builder: ActivityBuilder;
  suggestion: ConceptMapSuggestionApi;
  auto: boolean;
}) {
  const t = useT("WizardConceptMap");
  const tWs = useT("WorkspaceAdd");
  const [editing, setEditing] = useState(false);
  const mapped = hasConcepts(b);
  const { state } = suggestion;
  const goal = b.teachingGoal.trim();
  // Every action swaps the card's body, taking the pressed button with it; the
  // heading stays, so focus lands there rather than on <body>.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const refocus = () => headingRef.current?.focus();

  function use(map: SuggestedConceptMap) {
    b.setConceptMap(suggestionToEditorValue(map, b.nextElementKey));
    refocus();
  }

  function edit(open: boolean) {
    setEditing(open);
    refocus();
  }

  function another() {
    suggestion.requestNow();
    refocus();
  }

  function remove() {
    setEditing(false);
    const undo = removeKind(b, "conceptMap");
    notify(tWs("removed", { name: tWs("name_conceptMap") }), { action: { label: tWs("undo"), onClick: undo } });
    refocus();
  }

  let body: React.ReactNode;
  if (editing && b.conceptMap) {
    body = (
      <>
        <ConceptMapEditor value={b.conceptMap} onChange={b.setConceptMap} nextKey={b.nextElementKey} />
        <Button size="sm" className="self-start" onClick={() => edit(false)}>
          {t("done")}
        </Button>
      </>
    );
  } else if (mapped && b.conceptMap) {
    body = (
      <>
        <ConceptList nodes={b.conceptMap.nodes.filter((n) => n.label.trim())} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" aria-label={t("editAria")} onClick={() => edit(true)}>
            {t("edit")}
          </Button>
          <Button size="sm" variant="ghost" aria-label={t("removeAria")} onClick={remove}>
            {t("remove")}
          </Button>
        </div>
      </>
    );
  } else if (state.status === "loading") {
    body = (
      <div role="status" className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-5 w-3/5" />
      </div>
    );
  } else if (state.status === "ready") {
    const map = state.map;
    body = (
      <>
        <ConceptList
          nodes={map.nodes.map((n) => ({
            id: n.id,
            label: n.label,
            doneWhen: n.doneWhen,
            dependsOn: map.edges.filter((e) => e.to === n.id).map((e) => e.from),
          }))}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => use(map)}>
            {t("use")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("editAria")}
            onClick={() => {
              use(map);
              edit(true);
            }}
          >
            {t("edit")}
          </Button>
          <Button size="sm" variant="ghost" onClick={another}>
            {t("another")}
          </Button>
        </div>
      </>
    );
  } else if (state.status === "error") {
    body = (
      <p role="status" className="text-sm text-muted-foreground">
        {t("failed")}{" "}
        <button
          type="button"
          onClick={another}
          className="font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t("retry")}
        </button>
      </p>
    );
  } else if (!auto) {
    body = (
      <Button size="sm" className="self-start" disabled={!goal} onClick={another}>
        {t("suggestNow")}
      </Button>
    );
  } else if (wordCount(goal) < SUGGEST_MIN_WORDS) {
    body = <p className="text-sm text-muted-foreground">{t("waiting")}</p>;
  } else {
    body = null; // the pause before asking
  }

  return (
    <section
      aria-labelledby="wizard-concept-map-title"
      data-testid="wizard-concept-map"
      className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        >
          <Network className="h-4 w-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2
            ref={headingRef}
            tabIndex={-1}
            id="wizard-concept-map-title"
            className="flex items-center gap-2 text-sm font-semibold text-foreground outline-none"
          >
            {t("title")}
            {!mapped && state.status === "ready" && !editing ? <Badge>{t("suggested")}</Badge> : null}
          </h2>
          <p className="text-sm text-muted-foreground">{t("intro")}</p>
        </div>
      </div>
      {body}
    </section>
  );
}

interface ListNode {
  id: string;
  label: string;
  doneWhen: string;
  dependsOn: string[];
}

/** Foundational first: every concept after the ones it builds on, otherwise in
 *  the given order. A cycle (never valid, but never a crash) keeps its order. */
export function prerequisiteOrder<T extends { id: string; dependsOn: string[] }>(nodes: T[]): T[] {
  const ids = new Set(nodes.map((n) => n.id));
  const placed = new Set<string>();
  const out: T[] = [];
  let progressed = true;
  while (out.length < nodes.length && progressed) {
    progressed = false;
    for (const n of nodes) {
      if (placed.has(n.id)) continue;
      if (n.dependsOn.every((d) => placed.has(d) || !ids.has(d))) {
        placed.add(n.id);
        out.push(n);
        progressed = true;
      }
    }
  }
  for (const n of nodes) if (!placed.has(n.id)) out.push(n);
  return out;
}

/** The map as a teacher reads it: numbered concepts, what each builds on, and
 *  the bar for "understood" one click (or hover) away. */
function ConceptList({ nodes }: { nodes: ListNode[] }) {
  const t = useT("WizardConceptMap");
  const labelOf = new Map(nodes.map((n) => [n.id, n.label]));
  return (
    <ol aria-label={t("listAria")} className="flex flex-col gap-1.5">
      {prerequisiteOrder(nodes).map((n, i) => {
        const deps = n.dependsOn.map((d) => labelOf.get(d)).filter((l): l is string => Boolean(l));
        const line = (
          <>
            <span className="font-medium text-foreground">{n.label}</span>
            {deps.length ? (
              <span className="text-xs text-muted-foreground">{t("buildsOn", { list: deps.join(", ") })}</span>
            ) : null}
          </>
        );
        return (
          <li key={n.id} className="flex items-start gap-2 text-sm">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
            >
              {i + 1}
            </span>
            {n.doneWhen.trim() ? (
              <details className="group min-w-0 flex-1">
                <summary
                  title={n.doneWhen}
                  className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
                >
                  {line}
                  <ChevronDown
                    aria-hidden="true"
                    className="h-3.5 w-3.5 self-center text-muted-foreground transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="mt-1 text-xs text-muted-foreground">{t("doneWhen", { text: n.doneWhen })}</p>
              </details>
            ) : (
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">{line}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
