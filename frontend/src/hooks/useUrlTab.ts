"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Keep a page's tab (or scope / view) in the URL, so refresh, Back and a
 * shared link land where the teacher was (UI sweep 2026-11-09: tab, scope and
 * view state were `useState` on almost every teacher page).
 *
 * Unknown values fall back to `fallback`, so an old or mistyped link still
 * opens the page. Uses `replace`, not `push`: switching tabs should not fill
 * the history with one entry per click. A stepped flow passes
 * `{ history: "push" }` instead, so the browser's Back returns to the previous
 * step rather than leaving the page (the new-activity wizard, 2026-11-12).
 */
export function useUrlTab<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
  opts: { history?: "replace" | "push" } = {},
): [T, (next: T) => void] {
  const history = opts.history ?? "replace";
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params?.get(key) ?? null;
  const value = raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;

  const set = useCallback(
    (next: T) => {
      const sp = new URLSearchParams(params?.toString() ?? "");
      if (next === fallback) sp.delete(key);
      else sp.set(key, next);
      const qs = sp.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      if (history === "push") router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    [params, router, pathname, key, fallback, history],
  );

  return [value, set];
}
