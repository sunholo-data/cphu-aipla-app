/**
 * Regression net for the cold-load redirect (2026-08-13).
 *
 * A student with a perfectly valid group session in sessionStorage, who
 * reloaded or cold-loaded a /chat URL, was dumped on the home page. Their
 * session was intact the whole time.
 *
 * Mechanism: the group session is read back in a MOUNT EFFECT, so on the first
 * render `user` is null. The adapter reported `loading: false` regardless,
 * which told consumers "auth has settled, and there is nobody" — and the chat
 * page's `if (!loading && !user) router.replace("/")` acted on it before
 * hydration could land.
 *
 * It hid behind in-app navigation, where the provider is already mounted and
 * `user` is populated. Only a cold load hit it — which on a phone is the common
 * case: iOS evicts backgrounded tabs and reloads on return, and backgrounding
 * is what taking a photo of your work does.
 *
 * These tests assert the CONSUMER-VISIBLE contract (never `!loading && !user`
 * while a session exists) rather than the flag alone, because the flag is an
 * implementation detail and the redirect is the actual bug.
 */
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("fetch", vi.fn());

vi.mock("@/lib/anonymousGroupAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/anonymousGroupAuth")>();
  return { ...actual, isAnonymousGroupAuthMode: () => true };
});

import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ANON_GROUP_TOKEN_STORAGE_KEY } from "@/lib/anonymousGroupAuth";

const STORED = {
  token: "eyJhbGc.stored.token",
  uid: "anon-PHYS7K2N-deadbeef",
  expires_at: Date.now() / 1000 + 28800,
  group_code: "phys7k2n",
};

/** Mirrors the chat page's gate: the exact predicate that redirected. */
function RedirectProbe({ onRedirect }: { onRedirect: () => void }) {
  const { user, loading } = useAuth();
  if (!loading && !user) onRedirect();
  return (
    <div data-testid="state">
      {loading ? "loading" : user ? "signed-in" : "signed-out"}
    </div>
  );
}

function mount(onRedirect: () => void): ReactNode {
  return render(
    <AuthProvider>
      <RedirectProbe onRedirect={onRedirect} />
    </AuthProvider>,
  ) as unknown as ReactNode;
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

describe("group auth hydration — the cold-load redirect", () => {
  it("never reports signed-out while a stored session is waiting to hydrate", async () => {
    window.sessionStorage.setItem(ANON_GROUP_TOKEN_STORAGE_KEY, JSON.stringify(STORED));
    const onRedirect = vi.fn();

    mount(onRedirect);

    // The whole bug in one assertion: on the very first render, before the
    // hydration effect has run, the app must NOT conclude "nobody is here".
    expect(onRedirect, "redirected a signed-in student off the page").not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-in"));
    expect(onRedirect).not.toHaveBeenCalled();
  });

  it("still reports signed-out once it has actually looked and found nothing", async () => {
    // The other half: `hydrated` must be set unconditionally, or a genuinely
    // signed-out visitor hangs on "Loading…" forever and never gets redirected
    // to a page that can help them.
    const onRedirect = vi.fn();

    mount(onRedirect);

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-out"));
    expect(onRedirect).toHaveBeenCalled();
  });

  // A third test asserting the intermediate "loading" text on first paint was
  // written and then deleted: it passed against the BUGGY code too, because
  // testing-library's render flushes effects inside act() so the pre-hydration
  // render is never observable here. A test that cannot fail is worse than no
  // test — it reports safety it has not checked. The first case above is the
  // real guard, and it was verified to fail without the fix.
});
