import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AGUIProvider } from "@/providers/AGUIProvider";

// The bug (re-found 2026-06-16 on /teacher/analytics): in the deployed app the
// AuthContext is the anonymous-GROUP context, so for a teacher `useAuth().user`
// is permanently null. AGUIProvider's token effect short-circuited at
// `if (!user)` and never minted the teacher token → stream POST 401 "Missing
// Authorization header". This file reproduces that exact shape: useAuth() yields
// a null user, while a Firebase teacher IS signed in (subscribeToAuthState fires
// a user). With useTeacherAuth set, the agent MUST still carry the teacher token.

// useAuth = the anonymous-group context with NO teacher session.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, loading: false, getIdToken: async () => null }),
}));

const TEACHER = { uid: "teacher-1", email: "teacher@skole.dk" };

// Hoisted holder so the rotation test can drive onIdTokenChanged + swap the
// minted token mid-render.
const tokenMock = vi.hoisted(() => ({
  current: "teacher-token",
  idTokenCallback: null as ((t: string | null) => void) | null,
}));

vi.mock("@/lib/firebase", () => ({
  subscribeToAuthState: (cb: (u: unknown) => void) => {
    // Firebase hydrates the signed-in teacher asynchronously.
    queueMicrotask(() => cb(TEACHER));
    return () => {};
  },
  subscribeToIdToken: (cb: (t: string | null) => void) => {
    tokenMock.idTokenCallback = cb;
    return () => {
      tokenMock.idTokenCallback = null;
    };
  },
  getTeacherIdToken: async () => tokenMock.current,
  getIdToken: async () => null,
}));

vi.mock("@/lib/localMode", () => ({
  isLocalMode: () => false,
  LOCAL_MODE_WORKSHOP_USER: { uid: "local" },
}));

const httpAgentCtor = vi.fn();
vi.mock("@ag-ui/client", async () => {
  const actual = await vi.importActual<typeof import("@ag-ui/client")>("@ag-ui/client");
  class SpiedHttpAgent extends actual.HttpAgent {
    constructor(cfg: ConstructorParameters<typeof actual.HttpAgent>[0]) {
      super(cfg);
      httpAgentCtor(cfg);
    }
  }
  return { ...actual, HttpAgent: SpiedHttpAgent };
});

describe("AGUIProvider — useTeacherAuth with a null group user", () => {
  it("mints the TEACHER token even though useAuth().user is null (no 401)", async () => {
    httpAgentCtor.mockClear();
    const { findByText } = render(
      <AGUIProvider skillId="analytics-skill" useTeacherAuth>
        <div>analytics-chat</div>
      </AGUIProvider>,
    );

    // Gate lifts only once the teacher token resolves.
    expect(await findByText("analytics-chat")).toBeTruthy();

    await waitFor(() => {
      const authed = httpAgentCtor.mock.calls.find(
        ([cfg]) => cfg?.headers?.Authorization === "Bearer teacher-token",
      );
      expect(authed).toBeDefined();
    });

    // Once the teacher token has resolved, no later agent is built WITHOUT it
    // (the regression was an agent with empty headers reaching the stream).
    const firstAuthedIdx = httpAgentCtor.mock.calls.findIndex(
      ([cfg]) => cfg?.headers?.Authorization === "Bearer teacher-token",
    );
    for (const [cfg] of httpAgentCtor.mock.calls.slice(firstAuthedIdx)) {
      expect(cfg?.headers?.Authorization).toBe("Bearer teacher-token");
    }
  });

  it("refreshes the stream token on Firebase id-token rotation (no stale-token 401)", async () => {
    // Regression for 2026-06-27: the HttpAgent baked the token minted at mount;
    // onAuthStateChanged never fires on Firebase's ~hourly rotation, so a long
    // session sent an expired token → stream POST 401 "Token expired". The
    // provider now also listens to onIdTokenChanged and re-mints the token.
    httpAgentCtor.mockClear();
    tokenMock.current = "teacher-token";
    const { findByText } = render(
      <AGUIProvider skillId="analytics-skill" useTeacherAuth>
        <div>analytics-chat</div>
      </AGUIProvider>,
    );
    expect(await findByText("analytics-chat")).toBeTruthy();
    await waitFor(() => {
      expect(
        httpAgentCtor.mock.calls.some(([cfg]) => cfg?.headers?.Authorization === "Bearer teacher-token"),
      ).toBe(true);
    });

    // Firebase rotates the token; onIdTokenChanged fires with a fresh one.
    await act(async () => {
      tokenMock.idTokenCallback?.("teacher-token-rotated");
    });

    await waitFor(() => {
      const refreshed = httpAgentCtor.mock.calls.find(
        ([cfg]) => cfg?.headers?.Authorization === "Bearer teacher-token-rotated",
      );
      expect(refreshed).toBeDefined();
    });
  });
});
