/**
 * 1.1.145 M2 — every device on a group code renders the shared transcript.
 *
 * The 2026-10-05 seminar: several students on one code, one session, 61 turns.
 * They saw each other's PRESENCE (the pulse worked) but not each other's
 * MESSAGES, because 1.1.53 M1 refetched history only for a device that had
 * never sent anything (`watcherRevision = messages.length === 0 ? … : 0`). The
 * tutor answered from all of them; each screen showed a fraction.
 *
 * Pinned here, on the real page: a device that HAS sent still refetches on a
 * pulse revision bump, a groupmate's turn appears labelled, and nothing this
 * device sent renders twice (its live bubble is folded into the persisted copy).
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseSkillAgentReturn, SkillMessage } from "@/hooks/useSkillAgent";

const state = vi.hoisted(() => ({
  revision: 0,
  history: [] as Array<{ role: "user" | "assistant"; content: string; timestamp: number }>,
  messagesFetches: 0,
  liveMessages: [] as SkillMessage[],
  turnRefused: null as string | null,
  sendMessage: null as unknown as ReturnType<typeof vi.fn> & UseSkillAgentReturn["sendMessage"],
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { uid: "anon-grp", email: "", displayName: null },
    loading: false,
    getIdToken: async () => "GROUP-TOKEN",
  }),
}));

vi.mock("@/providers/AGUIProvider", () => ({
  AGUIProvider: ({ children }: { children: React.ReactNode }) => children,
  useAGUIAgent: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => ({
    get: (k: string) => (k === "activity_id" ? "act-bold" : k === "session" ? "shared-1" : null),
    toString: () => "activity_id=act-bold&session=shared-1",
  }),
}));

vi.mock("@/hooks/useSlugResolution", () => ({
  useSlugResolution: () => ({ skillId: "test-skill-id", loading: false, notFound: false, error: null }),
}));

vi.mock("@/hooks/useGroupPulse", () => ({
  useGroupPulse: () => ({ revision: state.revision, turnInFlight: false, activeDevices: 2 }),
}));

function agentReturn(): UseSkillAgentReturn {
  return {
    sessionId: "shared-1",
    messages: state.liveMessages,
    toolCalls: [],
    thinkingContent: "",
    isThinking: false,
    stageLabel: null,
    stage: null,
    sendMessage: state.sendMessage,
    isLoading: false,
    tidyingUp: false,
    compactions: [],
    error: null,
    clearError: vi.fn(),
    stop: vi.fn(),
    stall: null,
    retryStalled: vi.fn().mockResolvedValue(undefined),
    turnRefused: state.turnRefused,
    clearTurnRefused: () => {
      state.turnRefused = null;
    },
  };
}
vi.mock("@/hooks/useSkillAgent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/hooks/useSkillAgent")>();
  return { ...mod, useSkillAgent: vi.fn(() => agentReturn()) };
});

import ChatPage from "@/app/chat/[...path]/page";

const paramsPromise = Promise.resolve({ path: ["@user-1", "test-slug"] });

function installFetch() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    let body: unknown = {};
    if (url.includes("/api/auth/group/session")) {
      body = { sessionId: "shared-1", created: false };
    } else if (url.includes("/api/sessions/shared-1/messages")) {
      state.messagesFetches += 1;
      body = { messages: state.history, session_id: "shared-1", interactions: [] };
    }
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

async function renderPage() {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<ChatPage params={paramsPromise} />);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
  return result;
}

function countText(text: string): number {
  return screen.queryAllByText(text).length;
}

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  vi.stubEnv("NEXT_PUBLIC_AUTH_MODE", "anonymous_group_id");
  state.revision = 0;
  state.history = [];
  state.messagesFetches = 0;
  state.liveMessages = [];
  state.turnRefused = null;
  state.sendMessage = vi.fn().mockResolvedValue(undefined);
  installFetch();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("shared transcript (1.1.145 M2)", () => {
  it("a device that has sent still refetches on a revision bump, and no message renders twice", async () => {
    const view = await renderPage();
    await waitFor(() => expect(state.messagesFetches).toBe(1));

    // This device asks; its own stream renders the turn live.
    state.liveMessages = [
      { id: "u-mine", role: "user", content: "Hvorfor hopper bolden lavere?" },
      { id: "a-mine", role: "assistant", content: "Fordi der tabes energi ved hvert hop." },
    ];
    // Meanwhile a groupmate on another phone asks too; the server holds both.
    state.history = [
      { role: "user", content: "Hvorfor hopper bolden lavere?", timestamp: 1 },
      { role: "assistant", content: "Fordi der tabes energi ved hvert hop.", timestamp: 2 },
      { role: "user", content: "Hvor bliver energien af?", timestamp: 3 },
      { role: "assistant", content: "Den bliver til varme og lyd.", timestamp: 4 },
    ];
    state.revision = 1;
    await act(async () => {
      view.rerender(<ChatPage params={paramsPromise} />);
      await new Promise((r) => setTimeout(r, 0));
    });

    // The 1.1.53 gate would have stopped here: messages.length > 0.
    await waitFor(() => expect(state.messagesFetches).toBe(2));
    await waitFor(() => expect(screen.queryByText("Hvor bliver energien af?")).toBeTruthy());

    // The groupmate's turn and the tutor's answer to it are on this screen…
    expect(countText("Hvor bliver energien af?")).toBe(1);
    expect(countText("Den bliver til varme og lyd.")).toBe(1);
    // …this device's own turn is NOT doubled by its persisted copy…
    expect(countText("Hvorfor hopper bolden lavere?")).toBe(1);
    expect(countText("Fordi der tabes energi ved hvert hop.")).toBe(1);
    // …and only the groupmate's turn is labelled as another device's.
    expect(screen.getAllByTestId("from-group-device")).toHaveLength(1);
  });

  it("history that was already there on load is not labelled as a groupmate's", async () => {
    state.history = [
      { role: "user", content: "Tidligere spørgsmål", timestamp: 1 },
      { role: "assistant", content: "Tidligere svar", timestamp: 2 },
    ];
    await renderPage();
    await waitFor(() => expect(screen.queryByText("Tidligere spørgsmål")).toBeTruthy());
    expect(screen.queryAllByTestId("from-group-device")).toHaveLength(0);
  });

  it("a send refused by the turn-lock (409) is explained, kept, and sent once the groupmate's turn is done", async () => {
    // useSkillAgent hands back the refused text (it took the bubble back out).
    state.turnRefused = "Mit spørgsmål";
    const view = await renderPage();

    // The student sees WHY — not a generic error, and not silence.
    await waitFor(() =>
      expect(screen.getByText(/saved and will be sent|gemt og bliver sendt/i)).toBeTruthy(),
    );
    // Not re-sent straight away: it would only be refused again.
    expect(state.sendMessage).not.toHaveBeenCalled();

    // The groupmate's turn completes → the revision advances → it goes out once.
    state.revision = 1;
    await act(async () => {
      view.rerender(<ChatPage params={paramsPromise} />);
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(state.sendMessage).toHaveBeenCalledTimes(1));
    expect(state.sendMessage.mock.calls[0][0]).toBe("Mit spørgsmål");
  });
});
