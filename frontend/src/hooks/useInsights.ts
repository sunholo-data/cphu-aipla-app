/**
 * `useInsights` — tiny data hook for the four per-class insights
 * endpoints. Each call is independent so a slow query on one card
 * does not block the others (axiom 1 — INSTANT FEEL via per-card
 * skeleton + per-card error boundary in the panel).
 *
 * Returns the standard `{data, error, isLoading}` triple. No
 * client-side cache: M7's 60s server cache + Next's request dedup
 * across the panel's parallel fetches keep the network footprint
 * acceptable. Adding SWR/React-Query is a v1.1 conversation.
 */

"use client";

import { useEffect, useState } from "react";

interface Fetched<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
}

export function useInsightsFetch<T>(fetcher: () => Promise<T>, deps: ReadonlyArray<unknown>): Fetched<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetcher()
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, isLoading };
}
