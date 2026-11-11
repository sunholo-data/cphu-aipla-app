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
 * the history with one entry per click.
 */
export function useUrlTab<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
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
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname, key, fallback],
  );

  return [value, set];
}
