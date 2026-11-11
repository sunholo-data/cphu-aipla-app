/**
 * A stateful stand-in for `next/navigation`, for pages that keep their tab,
 * scope or window in the URL (`useUrlTab`, `?since=`).
 *
 * jsdom has no app router, so `useRouter()` throws and `useSearchParams()` has
 * nothing to read. A static mock is not enough either: `router.replace` must
 * change what `useSearchParams` returns AND re-render, or a test of "click the
 * tab, the page follows" passes against a page that ignores the URL.
 *
 * Usage, in a test file:
 *
 *   vi.mock("next/navigation", async () => (await import("@/test/nextNavigationMock")).navigationModule);
 *   import { nav } from "@/test/nextNavigationMock";
 *   beforeEach(() => nav.reset("/teacher/classes"));
 *   ...  expect(nav.search.get("scope")).toBe("all");
 */

import { useSyncExternalStore } from "react";
import { vi } from "vitest";

interface NavState {
  pathname: string;
  params: URLSearchParams;
}

let state: NavState = { pathname: "/", params: new URLSearchParams() };
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(pathname: string, search = "") {
  state = { pathname, params: new URLSearchParams(search) };
  for (const l of listeners) l();
}

function go(url: string) {
  const [path, query = ""] = url.split("?");
  set(path || state.pathname, query);
}

const replace = vi.fn(go);
const push = vi.fn(go);

function useNav(): NavState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export const navigationModule = {
  useSearchParams: () => useNav().params,
  usePathname: () => useNav().pathname,
  useRouter: () => ({ replace, push, back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
};

export const nav = {
  /** Start a test at this path and query, with fresh router spies. */
  reset(pathname = "/", search = "") {
    replace.mockClear();
    push.mockClear();
    set(pathname, search);
  },
  get pathname() {
    return state.pathname;
  },
  get search() {
    return state.params;
  },
  replace,
  push,
};
