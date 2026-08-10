/**
 * CHARACTERIZATION tests for the chat page god-file
 * (`src/app/chat/[...path]/page.tsx`, ~1269 lines).
 *
 * These pin the CURRENT load-bearing behaviour of ChatPage / ChatPageInner /
 * ChatShell BEFORE the planned decomposition of ChatShell. They do not assert
 * what the code *should* do — they assert what it *does* today, so the refactor
 * has a regression net. Any latent bug observed here is documented inline as
 * NOTE(latent) and intentionally NOT fixed.
 *
 * Priority order (this is the order of value):
 *   1. AUTH-TOKEN SELECTION — the dual-auth bug surface. The chat page mounts
 *      <AGUIProvider> WITHOUT `useTeacherAuth`, so the stream POST must carry
 *      the GROUP/STUDENT token (useAuth().getIdToken), never the Firebase
 *      TEACHER token (getTeacherIdToken). page.tsx:285.
 *   2. WORKSPACE/SURFACE MOUNTING — the ~11 `active*` slices set from the
 *      /activity-configs/active/{id} fetch gate whether the workspace column
 *      mounts (anon-group mode + non-empty config) or stays chat-only.
 *      ChatShell, page.tsx:448-449, 1212.
 *   3. DOC-INJECTION / threadId-resume wiring reachable in jsdom.
 *
 * Strategy: render the REAL ChatPage. Mock `useSkillAgent` (the hook has its
 * own 1094-line suite — we test the PAGE's decisions, not the hook). Crucially
 * we do NOT mock <AGUIProvider> here (the error-display suite does, which is
 * why it can't see the token choice) — we keep the real provider and spy on the
 * @ag-ui/client HttpAgent constructor to read which token reached its headers.
 */

import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import type { UseSkillAgentReturn } from "@/hooks/useSkillAgent";

// ---------------------------------------------------------------------------
// Hoisted mock state — vi.mock factories are hoisted above imports, so any
// per-test mutable state they read must come from vi.hoisted().
// ---------------------------------------------------------------------------

const authMock = vi.hoisted(() => ({
  // The STUDENT/GROUP token, returned by useAuth().getIdToken() (the path the
  // chat page is supposed to take).
  groupToken: "GROUP-TOKEN-student",
  // The TEACHER Firebase token — returned by getTeacherIdToken(). The chat
  // page must NEVER mint this (it doesn't pass useTeacherAuth to AGUIProvider).
  teacherToken: "TEACHER-TOKEN-firebase",
  // Spy that records every call to getTeacherIdToken so we can assert it's
  // never invoked from the student chat path.
  teacherTokenSpy: vi.fn(),
  // Spy on getIdToken (group) so we can assert the student path WAS taken.
  groupTokenSpy: vi.fn(),
}));

// Per-test fetch responder. Keyed by URL substring → JSON body.
const fetchMock = vi.hoisted(() => ({
  responder: (_url: string): unknown => ({}),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// useAuth = the anonymous-GROUP auth context. getIdToken yields the GROUP
// token (what AGUIProvider mints when useTeacherAuth is falsey — the chat page
// path). `user` is a synthetic group identity (email "" — anon-group shape).
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { uid: "group-uid-1", email: "", displayName: null },
    loading: false,
    getIdToken: async () => {
      authMock.groupTokenSpy();
      return authMock.groupToken;
    },
  }),
}));

// @/lib/firebase — the TEACHER token source + the auth-state subscriptions
// AGUIProvider only uses on the teacher path. getTeacherIdToken is spied so we
// can prove the chat page never calls it. We PARTIALLY mock (importOriginal) so
// the many other firebase exports the chat subtree pulls in (getFirestoreDb,
// onSnapshot helpers, etc.) keep working — overriding only the token + auth
// subscription surface AGUIProvider reads.
vi.mock("@/lib/firebase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/firebase")>();
  return {
    ...actual,
    subscribeToAuthState: (cb: (u: unknown) => void) => {
      // Fire a signed-in teacher async — mirrors Firebase. The chat page does
      // NOT use the teacher path, so this should be irrelevant to the token the
      // stream carries; firing it makes the "never teacher" assertion stronger.
      queueMicrotask(() => cb({ uid: "teacher-uid", email: "t@skole.dk" }));
      return () => {};
    },
    subscribeToIdToken: () => () => {},
    getIdToken: async () => authMock.groupToken,
    getTeacherIdToken: async () => {
      authMock.teacherTokenSpy();
      return authMock.teacherToken;
    },
    // Firestore is not configured in tests — return null so onSnapshot-based
    // doc-browser hooks early-return instead of touching a real SDK.
    getFirestoreDb: () => null,
  };
});

vi.mock("@/lib/localMode", () => ({
  isLocalMode: () => false,
  LOCAL_MODE_WORKSHOP_USER: { uid: "local" },
  LOCAL_MODE_STUB_TOKEN: "local-stub",
}));

// Spy on HttpAgent construction WITHOUT replacing the class — useAGUIAgent
// needs a real AbstractAgent subclass. This is the SAME pattern the existing
// AGUIProvider suite uses (src/providers/__tests__/AGUIProvider.test.tsx).
const httpAgentCtor = vi.hoisted(() => vi.fn());
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

// useSkillAgent — mock the hook (it has its own suite). We test the PAGE's
// wiring around it, not the hook. Returns an empty, idle chat.
const mockSendMessage = vi.fn().mockResolvedValue(undefined);
function makeAgentReturn(
  overrides: Partial<UseSkillAgentReturn> = {},
): UseSkillAgentReturn {
  return {
    sessionId: "thread-abc",
    messages: [],
    toolCalls: [],
    thinkingContent: "",
    isThinking: false,
    stageLabel: null,
    sendMessage: mockSendMessage,
    isLoading: false,
    tidyingUp: false,
    compactions: [],
    error: null,
    clearError: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  };
}
vi.mock("@/hooks/useSkillAgent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/hooks/useSkillAgent")>();
  return { ...mod, useSkillAgent: vi.fn(() => makeAgentReturn()) };
});

// useSlugResolution — resolve the slug straight to a skill id (no fetch).
vi.mock("@/hooks/useSlugResolution", () => ({
  useSlugResolution: () => ({
    skillId: "test-skill-id",
    loading: false,
    notFound: false,
    error: null,
  }),
}));

// Data hooks feeding the teacher-mode doc-UI sidebar (sessions list + skills
// bar). Orthogonal to the three pinned behaviours — mock to safe empty states
// so the sidebar subtree renders without a shaped fetch response. (In anon-group
// mode the doc-UI is hidden entirely, so this only matters for teacher mode.)
vi.mock("@/hooks/useSkillSessions", () => ({
  useSkillSessions: () => ({
    sessions: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/useUserSkills", () => ({
  useUserSkills: () => ({ skills: [], isLoading: false, error: null }),
}));

// next/navigation — capture router.replace so we can assert the threadId-resume
// URL writeback, and drive useSearchParams per test.
const routerReplace = vi.hoisted(() => vi.fn());
const searchParamsState = vi.hoisted(() => ({
  // Map of param name → value. `get` reads from here.
  params: {} as Record<string, string | null>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  useSearchParams: () => ({
    get: (k: string) => searchParamsState.params[k] ?? null,
    toString: () =>
      Object.entries(searchParamsState.params)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}=${v}`)
        .join("&"),
  }),
}));

// Heavyweight workspace subtree — replace with a light marker so behaviour #2
// asserts the PAGE's mount DECISION, not the workspace internals (which mount
// sandbox iframes, sim launchers, etc.). We keep the WorkspaceShell wrapper's
// aria-label contract by rendering an aside with the same accessible name.
vi.mock("@/components/workspace/WorkspaceShell", () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => (
    <aside aria-label="Workspace" data-testid="workspace-shell-stub">
      {children}
    </aside>
  ),
}));
vi.mock("@/components/workspace/StudentWorkspace", () => ({
  StudentWorkspace: (props: Record<string, unknown>) => (
    <div data-testid="student-workspace-stub">
      student-workspace artefact={String((props as { artefact?: unknown }).artefact != null)}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Imports of the system under test — AFTER the mocks above.
// ---------------------------------------------------------------------------
import ChatPage from "@/app/chat/[...path]/page";
import { useSkillAgent } from "@/hooks/useSkillAgent";

const paramsPromise = Promise.resolve({ path: ["@user-1", "test-slug"] });

// ChatPage calls `use(params)` (React 19). On the FIRST render of an unsettled
// promise the component suspends; with no <Suspense> boundary the subtree
// renders nothing until the promise settles. `waitFor` on a side-effect spy
// won't flush that suspension on its own. Wrapping render in act + flushing a
// macrotask lets `use()` resolve and the page mount before assertions run.
async function renderChatPage() {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<ChatPage params={paramsPromise} />);
    // Flush the resolved-promise microtask + the mount-time effects.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
  return result;
}

// A flexible global fetch stub. fetchWithAuth → getIdToken (mocked) → fetch.
// The page fires several best-effort GETs/POSTs on mount (skill meta, user
// skills, sessions, active-session resume, activity-configs, voice config, …).
// We answer them all from fetchMock.responder so nothing rejects unhandled.
function installFetchStub() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = fetchMock.responder(url);
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  // jsdom lacks scrollTo / crypto.randomUUID in some envs — stub both.
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  if (!globalThis.crypto?.randomUUID) {
    // @ts-expect-error – minimal stub
    globalThis.crypto = { randomUUID: () => "uuid-" + Math.random().toString(36).slice(2) };
  }
  vi.clearAllMocks();
  fetchMock.responder = () => ({});
  searchParamsState.params = {};
  installFetchStub();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ===========================================================================
// 1. AUTH-TOKEN SELECTION  (HIGHEST VALUE)
// ===========================================================================
describe("auth-token selection — the dual-auth bug surface", () => {
  it("student/anon-group: stream HttpAgent carries the GROUP token, never the teacher token", async () => {
    // Anon-group (student) mode.
    vi.stubEnv("NEXT_PUBLIC_AUTH_MODE", "anonymous_group_id");
    httpAgentCtor.mockClear();
    authMock.teacherTokenSpy.mockClear();

    await renderChatPage();

    // The provider gates children until the GROUP token resolves; once it does,
    // an HttpAgent is built with `Authorization: Bearer <group token>`.
    await waitFor(() => {
      const withGroup = httpAgentCtor.mock.calls.find(
        ([cfg]) => cfg?.headers?.Authorization === `Bearer ${authMock.groupToken}`,
      );
      expect(withGroup).toBeDefined();
    });

    // The group path WAS exercised (non-vacuous): AGUIProvider read
    // useAuth().getIdToken to mint the bearer.
    expect(authMock.groupTokenSpy).toHaveBeenCalled();

    // CRUX: the chat page does NOT pass useTeacherAuth to AGUIProvider
    // (page.tsx:285), so getTeacherIdToken must NEVER be called and NO agent
    // ever carries the teacher token.
    expect(authMock.teacherTokenSpy).not.toHaveBeenCalled();
    const anyTeacher = httpAgentCtor.mock.calls.find(
      ([cfg]) => cfg?.headers?.Authorization === `Bearer ${authMock.teacherToken}`,
    );
    expect(anyTeacher).toBeUndefined();
  });

  it("teacher/Firebase mode (default env): still the GROUP path — page never opts into useTeacherAuth", async () => {
    // Default vitest env: NEXT_PUBLIC_AUTH_MODE unset → isAnonymousGroupAuthMode
    // is false (the inherited 'teacher/Firebase' default). But the chat page
    // STILL mounts <AGUIProvider> with NO useTeacherAuth prop, so the token
    // source is useAuth().getIdToken — which our mock yields as the group token.
    // This pins that the chat surface is hardwired to the non-teacher path
    // regardless of auth mode (the teacher co-pilots are separate surfaces that
    // pass useTeacherAuth explicitly).
    httpAgentCtor.mockClear();
    authMock.teacherTokenSpy.mockClear();

    await renderChatPage();

    await waitFor(() => {
      const withGroup = httpAgentCtor.mock.calls.find(
        ([cfg]) => cfg?.headers?.Authorization === `Bearer ${authMock.groupToken}`,
      );
      expect(withGroup).toBeDefined();
    });
    expect(authMock.teacherTokenSpy).not.toHaveBeenCalled();
  });

  it("stream targets the per-skill SSE endpoint via /api/proxy", async () => {
    httpAgentCtor.mockClear();
    await renderChatPage();
    await waitFor(() => {
      const lastCfg = httpAgentCtor.mock.calls.at(-1)?.[0];
      expect(lastCfg?.url).toBe("/api/proxy/api/skill/test-skill-id/stream");
    });
  });
});

// ===========================================================================
// 2. WORKSPACE / SURFACE MOUNTING
// ===========================================================================
describe("workspace mounting — gated on anon-group mode + non-empty activity config", () => {
  it("chat-only when the activity-config has NO elements (empty config)", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_MODE", "anonymous_group_id");
    // The /activity-configs/active/{id} fetch returns an empty config → every
    // active* slice stays empty → workspaceKind 'none' → no workspace column.
    fetchMock.responder = (url) => {
      if (url.includes("/activity-configs/active/")) {
        return {
          checklist: [],
          table: [],
          chart: [],
          calculator: [],
          note: [],
          solution: [],
          document: [],
          artefact: null,
          persona: null,
          materials: [],
        };
      }
      return {};
    };

    await renderChatPage();

    // Let mount-time fetches settle.
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/message/i)).toBeTruthy();
    });
    // No WorkspaceShell — the workspace column is absent.
    expect(screen.queryByTestId("workspace-shell-stub")).toBeNull();
    expect(screen.queryByLabelText("Workspace")).toBeNull();
  });

  it("mounts the workspace column when the activity-config has an artefact", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_MODE", "anonymous_group_id");
    fetchMock.responder = (url) => {
      if (url.includes("/activity-configs/active/")) {
        return {
          checklist: [],
          table: [],
          chart: [],
          calculator: [],
          note: [],
          solution: [],
          document: [],
          // A vetted sim artefact present → workspaceKind 'elements' →
          // showWorkspace true (in anon-group mode).
          artefact: { id: "boldkast", title: "Boldkast", artefactPath: "boldkast/v1/" },
          persona: null,
          materials: [],
        };
      }
      return {};
    };

    await renderChatPage();

    await waitFor(() => {
      expect(screen.getByTestId("workspace-shell-stub")).toBeTruthy();
    });
    // The single generic StudentWorkspace render path is used for any non-empty
    // workspace (USR-1), and it received the artefact.
    const sw = await screen.findByTestId("student-workspace-stub");
    expect(sw.textContent).toContain("artefact=true");
  });

  it("mounts the workspace column when the config has a teacher-authored checklist (no sim)", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_MODE", "anonymous_group_id");
    fetchMock.responder = (url) => {
      if (url.includes("/activity-configs/active/")) {
        return {
          checklist: [{ id: "c1", label: "Step 1", done: false }],
          table: [],
          chart: [],
          calculator: [],
          note: [],
          solution: [],
          document: [],
          artefact: null,
          persona: null,
          materials: [],
        };
      }
      return {};
    };

    await renderChatPage();

    await waitFor(() => {
      expect(screen.getByTestId("workspace-shell-stub")).toBeTruthy();
    });
    const sw = await screen.findByTestId("student-workspace-stub");
    // No sim attached for a bare concept activity.
    expect(sw.textContent).toContain("artefact=false");
  });

  it("NEVER mounts the workspace for a non-anon (teacher/Firebase) user, even with a non-empty config", async () => {
    // Default env: isAnonymousGroupAuthMode() === false. showWorkspace is
    // `isAnonymousGroupAuthMode() && (...)`, so it can never be true here.
    // This pins the auth-mode gate on the workspace surface (page.tsx:448-449).
    fetchMock.responder = (url) => {
      if (url.includes("/activity-configs/active/")) {
        return {
          checklist: [{ id: "c1", label: "Step 1", done: false }],
          artefact: { id: "boldkast", title: "Boldkast", artefactPath: "boldkast/v1/" },
        };
      }
      return {};
    };

    await renderChatPage();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/message/i)).toBeTruthy();
    });
    // NOTE: the config fetch effect early-returns when !isAnonymousGroupAuthMode
    // (page.tsx:460-473) so the active* slices are never even set here — but the
    // showWorkspace gate would suppress the column regardless. Either way: no
    // workspace for a teacher-mode user.
    expect(screen.queryByTestId("workspace-shell-stub")).toBeNull();
  });
});

// ===========================================================================
// 3. DOC-INJECTION / threadId-resume wiring (jsdom-reachable slices)
// ===========================================================================
describe("session resume / threadId wiring (reachable in jsdom)", () => {
  it("fresh chat (no ?session=, no stored group session): does NOT write a resume ?session= on mount", async () => {
    // No anon-group mode → the group-level fast-path resume (readStoredGroupSession)
    // and the active-session backend fetch are both gated off
    // (page.tsx:223, 248), so router.replace must NOT be called to inject a
    // resumedSessionId at mount.
    searchParamsState.params = {};
    await renderChatPage();
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/message/i)).toBeTruthy();
    });
    // The only router.replace that should ever fire here is the post-first-turn
    // URL writeback — which needs messages.length > 0. With an idle mocked
    // agent (0 messages) it never fires. So no replace at all on a fresh mount.
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("resuming via ?session= in the URL: the agent threadId equals the URL session and no resume-replace fires", async () => {
    // ?session= already in the URL on mount → useStableThreadId adopts it →
    // AGUIProvider builds its HttpAgent with that threadId. The mount-time
    // resume effects all no-op because urlSessionId is non-null
    // (page.tsx:223, 232, 248).
    searchParamsState.params = { session: "existing-session-42" };
    httpAgentCtor.mockClear();

    await renderChatPage();

    await waitFor(() => {
      const withThread = httpAgentCtor.mock.calls.find(
        ([cfg]) => cfg?.threadId === "existing-session-42",
      );
      expect(withThread).toBeDefined();
    });
    // No resume-injection replace — the URL already points at the session.
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("anon-group with a stored resumedSessionId and no ?session=: writes the stored session into the URL on mount", async () => {
    // The 1.F fast-path: in anon-group mode, with a fresh stored group session
    // carrying a resumedSessionId and no ?session= yet, the mount effect
    // (page.tsx:231-237) writes ?session=<resumedSessionId> via router.replace.
    vi.stubEnv("NEXT_PUBLIC_AUTH_MODE", "anonymous_group_id");
    searchParamsState.params = {}; // no ?session=, no activity_id (group scope)

    // Seed a stored group session with a resumedSessionId (sessionStorage is
    // jsdom-backed). expires_at must be in the future to survive the freshness
    // gate in readStoredGroupSession.
    window.sessionStorage.setItem(
      "aitana:anon_group_session",
      JSON.stringify({
        token: authMock.groupToken,
        uid: "group-uid-1",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        resumedSessionId: "stored-resume-77",
        skill_ids: [],
      }),
    );

    try {
      await renderChatPage();
      await waitFor(() => {
        expect(routerReplace).toHaveBeenCalled();
      });
      // The replace target carries ?session=stored-resume-77.
      const calledWith = routerReplace.mock.calls.map((c) => String(c[0]));
      expect(calledWith.some((u) => u.includes("session=stored-resume-77"))).toBe(true);
    } finally {
      window.sessionStorage.clear();
    }
  });

  it("an activity_id (act-) chat suppresses the group-level resume fast-path", async () => {
    // page.tsx:223 — for an ALS-1 activity chat (activity_id starts with 'act-')
    // the group-level resumedSessionId is suppressed (it's the wrong scope); the
    // per-activity active-session fetch is authoritative instead. So even with a
    // stored resumedSessionId, NO ?session= writeback from the group fast-path.
    vi.stubEnv("NEXT_PUBLIC_AUTH_MODE", "anonymous_group_id");
    searchParamsState.params = { activity_id: "act-physics-1" };

    window.sessionStorage.setItem(
      "aitana:anon_group_session",
      JSON.stringify({
        token: authMock.groupToken,
        uid: "group-uid-1",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        resumedSessionId: "stored-resume-should-be-ignored",
        skill_ids: [],
      }),
    );

    // The per-activity active-session fetch returns null (no live session) so
    // it doesn't write either — isolating the group fast-path suppression.
    fetchMock.responder = (url) => {
      if (url.includes("/auth/group/active-session")) return { sessionId: null };
      return {};
    };

    try {
      await renderChatPage();
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/message/i)).toBeTruthy();
      });
      // Give the async active-session fetch a tick to (not) write.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      const calledWith = routerReplace.mock.calls.map((c) => String(c[0]));
      expect(
        calledWith.some((u) => u.includes("stored-resume-should-be-ignored")),
      ).toBe(false);
    } finally {
      window.sessionStorage.clear();
    }
  });

  it("doc-context: a fresh (non-resumed) send carries resumedSession:false to the agent", async () => {
    // Pin the resume flag wiring into sendMessage. On a fresh chat
    // enteredViaResume is false, so handleSend / onChatMessage pass
    // resumedSession:false. We drive sendMessage via the mocked agent and the
    // composer form. (The full doc-injection path needs a real stream; here we
    // pin the page-side flag the backend keys off — page.tsx:739-743.)
    searchParamsState.params = {};
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useSkillAgent).mockReturnValue(makeAgentReturn({ sendMessage: sendSpy }));

    await renderChatPage();

    const input = (await screen.findByPlaceholderText(/message/i)) as HTMLInputElement;
    // Type + submit.
    fireEvent.change(input, { target: { value: "hello tutor" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(sendSpy).toHaveBeenCalled();
    });
    const [text, opts] = sendSpy.mock.calls[0];
    expect(text).toBe("hello tutor");
    expect(opts).toMatchObject({ resumedSession: false });
    // documentIds is present (the computed included-doc list; empty here).
    expect(Array.isArray(opts.documentIds)).toBe(true);
  });
});
