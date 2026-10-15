"use client";

import { useEffect, useState } from "react";

import { listArtefacts, type ArtefactSummary } from "@/lib/teacherApi";

// One catalogue fetch per page load, shared by every card that names a sim: the
// activity library renders dozens of cards and each would otherwise ask again.
// A failure resolves to an empty list (callers fall back to the raw id) and is
// forgotten, so the next mount may try again.
let pending: Promise<ArtefactSummary[]> | null = null;

function load(): Promise<ArtefactSummary[]> {
  if (!pending) {
    pending = listArtefacts().catch(() => {
      pending = null;
      return [];
    });
  }
  return pending;
}

/** For tests: drop the cached catalogue. */
export function resetSimCatalogue(): void {
  pending = null;
}

/**
 * The sim catalogue as a map by id, or null until it has loaded. Replaces the
 * hand-kept name tables that named only the first three sims, so a card for an
 * activity built on any later sim showed its raw id.
 */
export function useSimCatalogue(): Map<string, ArtefactSummary> | null {
  const [byId, setById] = useState<Map<string, ArtefactSummary> | null>(null);
  useEffect(() => {
    let alive = true;
    void load().then((list) => alive && setById(new Map(list.map((a) => [a.id, a]))));
    return () => {
      alive = false;
    };
  }, []);
  return byId;
}
