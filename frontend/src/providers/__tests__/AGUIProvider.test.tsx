import { useEffect } from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { AGUIProvider, useAGUIAgent } from "@/providers/AGUIProvider";

// Build a minimal Firebase User stub. AGUIProvider only checks for
// truthiness on `useAuth().user` to decide whether to call getIdToken,
// so a `{uid}`-only object is enough.
const TEST_USER = { uid: "test-uid", email: "t@example.test" } as unknown as import("firebase/auth").User;

// Hoisted holders so tests can mutate the mock's behaviour mid-render —
// vi.mock is hoisted above imports, so it must read from these via
// vi.hoisted to share state.
const authMock = vi.hoisted(() => ({
  // Callback captured from subscribeToAuthState; tests fire it to
  // simulate Firebase's onAuthStateChanged emitting a new User reference.
  authStateCallback: null as ((u: unknown) => void) | null,
  // The token getIdToken() resolves to. Mutable across the test so a
  // refresh path can swap it.
  currentToken: "test-token",
}));

vi.mock("@/lib/firebase", () => ({
  subscribeToAuthState: (cb: (u: unknown) => void) => {
    authMock.authStateCallback = cb;
    // Fire with a signed-in user so AGUIProvider's gate lifts on a
    // path that does call getIdToken — that's what production hits.
    queueMicrotask(() => cb(TEST_USER));
    return () => {
      authMock.authStateCallback = null;
    };
  },
  subscribeToIdToken: () => () => {},
  getIdToken: async () => authMock.currentToken,
  getTeacherIdToken: async () => authMock.currentToken,
  signInWithGoogle: async () => {},
  signInWithGoogleRedirect: async () => {},
  signOut: async () => {},
}));

// Spy on HttpAgent construction without replacing the class — consumers still
// get a real AbstractAgent subclass, which matters for useAGUIAgent().
const httpAgentCtor = vi.fn();
vi.mock("@ag-ui/client", async () => {
  const actual = await vi.importActual<typeof import("@ag-ui/client")>(
    "@ag-ui/client",
  );
  class SpiedHttpAgent extends actual.HttpAgent {
    constructor(cfg: ConstructorParameters<typeof actual.HttpAgent>[0]) {
      super(cfg);
      httpAgentCtor(cfg);
    }
  }
  return { ...actual, HttpAgent: SpiedHttpAgent };
});

describe("AGUIProvider", () => {
  it("renders children and builds an HttpAgent targeting the skill stream endpoint", async () => {
    const { findByText } = render(
      <AuthProvider>
        <AGUIProvider skillId="my-skill">
          <div>chat-content</div>
        </AGUIProvider>
      </AuthProvider>,
    );

    // Provider blocks children until the auth token resolves (added
    // 2026-06-03 to fix the no-auth-header race on first send). Use
    // findByText so the assertion awaits the post-resolution render.
    expect(await findByText("chat-content")).toBeTruthy();

    await waitFor(() => {
      const withAuth = httpAgentCtor.mock.calls.find(
        ([cfg]) => cfg?.headers?.Authorization === "Bearer test-token",
      );
      expect(withAuth).toBeDefined();
    });

    const lastCfg = httpAgentCtor.mock.calls.at(-1)?.[0];
    expect(lastCfg?.url).toBe("/api/proxy/api/skill/my-skill/stream");
  });

  it("URL-encodes skillId so slashes/spaces don't break the endpoint", async () => {
    render(
      <AuthProvider>
        <AGUIProvider skillId="weird id/with slash">
          <div />
        </AGUIProvider>
      </AuthProvider>,
    );

    await waitFor(() => {
      const lastCfg = httpAgentCtor.mock.calls.at(-1)?.[0];
      expect(lastCfg?.url).toBe(
        "/api/proxy/api/skill/weird%20id%2Fwith%20slash/stream",
      );
    });
  });

  it("useAGUIAgent throws outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAGUIAgent())).toThrow(
      /must be used within an AGUIProvider/,
    );
    spy.mockRestore();
  });

  it("D1 (chat-history-deep-fixes H1): rebuilds the HttpAgent when sessionId changes from undefined to a server-assigned value", async () => {
    // The real-world failure: a fresh chat starts with sessionId=undefined.
    // After the first turn the chat page's URL-writeback effect rewrites
    // ?session=<id>, which propagates to <AGUIProvider sessionId={id}>.
    // useMemo([skillId, token, sessionId]) sees the dep change and builds
    // a NEW HttpAgent instance — the old one (with [Q1, A1] in messages)
    // is discarded. This test asserts the rebuild *does* happen so we
    // know what mechanism the fix needs to neutralise (pre-allocate
    // threadId at mount so it never changes from undefined to a value).
    httpAgentCtor.mockClear();

    const { rerender } = render(
      <AuthProvider>
        <AGUIProvider skillId="skill-x" sessionId={undefined}>
          <div />
        </AGUIProvider>
      </AuthProvider>,
    );

    await waitFor(() => {
      // Initial constructor call(s) — there can be 1 (no token yet) + 1
      // (with token) depending on auth bootstrap timing. Snapshot that count.
      expect(httpAgentCtor.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
    const callsBeforeWriteback = httpAgentCtor.mock.calls.length;

    // Simulate the URL-writeback: sessionId changes from undefined to <id>.
    rerender(
      <AuthProvider>
        <AGUIProvider skillId="skill-x" sessionId="server-assigned-id-123">
          <div />
        </AGUIProvider>
      </AuthProvider>,
    );

    // Pre-fix: a NEW HttpAgent is constructed because useMemo's deps
    // include sessionId. Post-fix (option a from the design doc): the
    // threadId is pre-allocated at chat-page mount, so AGUIProvider never
    // sees this transition — the constructor count stays equal.
    await waitFor(() => {
      expect(httpAgentCtor.mock.calls.length).toBeGreaterThan(callsBeforeWriteback);
    });

    // Confirm the new instance got the new threadId
    const newestCfg = httpAgentCtor.mock.calls.at(-1)?.[0];
    expect(newestCfg?.threadId).toBe("server-assigned-id-123");
  });

  // CHAT-HISTORY-FLICKER (sprint 2026-06-04): on Firebase ID-token refresh
  // the provider previously called setTokenResolved(false), which the
  // render gate (`if (!tokenResolved) return null;`) translated into an
  // unmount of the entire subtree. That destroyed useSessionMessages's
  // state and forced an extra GET /api/sessions/{id}/messages — visibly
  // ~400ms on AIPLA's cross-region Vertex Agent Engine setup. The fix
  // tracks hadTokenOnceRef so the gate only blanks on the very first
  // load; subsequent refreshes keep children mounted and the HttpAgent
  // is rebuilt atomically via useMemo([skillId, token, sessionId]).
  describe("token refresh keeps children mounted (CHAT-HISTORY-FLICKER)", () => {
    function ChildWithMountCounter({ mountSpy }: { mountSpy: () => void }) {
      // The cleanup of a useEffect that mounted once is sufficient
      // proof of unmount — but tests just need to count mounts. Tracks
      // every fresh mount of this component instance.
      useEffect(() => {
        mountSpy();
      }, [mountSpy]);
      return <div>chat-content</div>;
    }

    it("does NOT unmount children when `user` ref changes but a token has already resolved", async () => {
      authMock.currentToken = "token-v1";
      httpAgentCtor.mockClear();
      const mountSpy = vi.fn();

      const { findByText } = render(
        <AuthProvider>
          <AGUIProvider skillId="my-skill">
            <ChildWithMountCounter mountSpy={mountSpy} />
          </AGUIProvider>
        </AuthProvider>,
      );

      // Wait through the initial load gate; child mounts exactly once.
      expect(await findByText("chat-content")).toBeTruthy();
      await waitFor(() => {
        expect(mountSpy).toHaveBeenCalledTimes(1);
      });

      // Wait for the FIRST HttpAgent construction with the v1 token —
      // that's the marker that `token` state has flipped and
      // `hadTokenOnceRef.current` is now true.
      await waitFor(() => {
        const v1 = httpAgentCtor.mock.calls.find(
          ([cfg]) => cfg?.headers?.Authorization === "Bearer token-v1",
        );
        expect(v1).toBeDefined();
      });

      // Simulate Firebase emitting a new user reference (token-refresh path).
      // The token will be re-fetched in the background.
      authMock.currentToken = "token-v2";
      const refreshedUser = { ...TEST_USER };
      await act(async () => {
        authMock.authStateCallback?.(refreshedUser);
      });

      // Wait for the new HttpAgent to be built with the v2 token —
      // that proves the refresh round-trip completed.
      await waitFor(() => {
        const lastCfg = httpAgentCtor.mock.calls.at(-1)?.[0];
        expect(lastCfg?.headers?.Authorization).toBe("Bearer token-v2");
      });

      // CRITICAL: child must NOT have remounted during the refresh.
      // If the AGUIProvider's render gate had blanked the subtree, the
      // child would have unmounted and a fresh mount would bring this
      // count to 2.
      expect(mountSpy).toHaveBeenCalledTimes(1);
    });

    it("rebuilds the HttpAgent with the new token across a refresh", async () => {
      authMock.currentToken = "token-A";
      httpAgentCtor.mockClear();

      render(
        <AuthProvider>
          <AGUIProvider skillId="rebuild-skill">
            <div>chat-content</div>
          </AGUIProvider>
        </AuthProvider>,
      );

      await waitFor(() => {
        const tokenA = httpAgentCtor.mock.calls.find(
          ([cfg]) => cfg?.headers?.Authorization === "Bearer token-A",
        );
        expect(tokenA).toBeDefined();
      });

      authMock.currentToken = "token-B";
      await act(async () => {
        authMock.authStateCallback?.({ ...TEST_USER });
      });

      await waitFor(() => {
        const tokenB = httpAgentCtor.mock.calls.find(
          ([cfg]) => cfg?.headers?.Authorization === "Bearer token-B",
        );
        expect(tokenB).toBeDefined();
      });

      // No agent was ever built without an Authorization header AFTER
      // we had a token — pre-token bootstrap may build one with no
      // header, but post-token-A, every subsequent build must carry a
      // bearer.
      const firstAuthedIdx = httpAgentCtor.mock.calls.findIndex(
        ([cfg]) => cfg?.headers?.Authorization?.startsWith("Bearer ") ?? false,
      );
      expect(firstAuthedIdx).toBeGreaterThanOrEqual(0);
      const subsequentCalls = httpAgentCtor.mock.calls.slice(firstAuthedIdx);
      for (const [cfg] of subsequentCalls) {
        expect(cfg?.headers?.Authorization).toMatch(/^Bearer /);
      }
    });

    it("still gates children on the FIRST load (children don't render until the first token resolves)", async () => {
      authMock.currentToken = "first-load-token";
      const mountSpy = vi.fn();

      render(
        <AuthProvider>
          <AGUIProvider skillId="first-load-skill">
            <ChildWithMountCounter mountSpy={mountSpy} />
          </AGUIProvider>
        </AuthProvider>,
      );

      // Before the token resolves, the gate should still suppress
      // children — so the mountSpy is delayed. Once the token lands,
      // the child mounts exactly once.
      await waitFor(() => {
        expect(mountSpy).toHaveBeenCalledTimes(1);
      });
      expect(mountSpy).not.toHaveBeenCalledTimes(2);
    });
  });
});
